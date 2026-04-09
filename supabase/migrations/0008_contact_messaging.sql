-- 0008_contact_messaging.sql
--
-- C8 anchor. Ships the contact/meeting/messaging-bridge schema plus the
-- abuse-control rate-limit primitive that C8 and C9 both rely on. Five tables
-- and one security-definer helper:
--
--   - contact_requests         : initial outreach from a receiver to a provider
--   - meeting_proposals        : in-person / video / phone meeting scheduling
--                                once a contact request is accepted
--   - contact_threads          : thin messaging bridge per accepted request
--                                (retired in C9 when `conversations` ships)
--   - contact_thread_posts     : append-only posts inside a bridge thread
--   - rate_limit_buckets       : generic rolling counter, owned by SECURITY
--                                DEFINER helper app.bump_rate_limit()
--
-- DESIGN NOTES / REVIEW FLAGS
-- ---------------------------
-- 1. Status-transition enforcement lives in guard triggers rather than
--    per-policy WITH CHECK expressions, because RLS cannot compare OLD to
--    NEW. This mirrors tg_documents_guard / tg_provider_profiles_guard_*.
--    The triggers also stamp responded_at on the transition so the Server
--    Actions do not have to remember to set it.
--
-- 2. contact_threads has NO INSERT policy. The only legal way to create a
--    thread is the AFTER UPDATE trigger on contact_requests, which runs as
--    SECURITY DEFINER so it is not constrained by RLS. This keeps the
--    invariant "one thread per accepted request" a database-level guarantee
--    rather than an application-level convention.
--
-- 3. contact_thread_posts is append-only from the user's perspective: no
--    UPDATE policy, no DELETE policy, no updated_at column. Posts migrate
--    into `conversations` in C9 and retain their immutability there.
--
-- 4. meeting_at-in-the-future is enforced by a BEFORE INSERT trigger rather
--    than a CHECK constraint because CHECK cannot reference now().
--
-- 5. rate_limit_buckets has RLS enabled with ZERO policies. All access goes
--    through app.bump_rate_limit(), which is SECURITY DEFINER. Ordinary
--    users never hold a GRANT on the table, so the table is default-deny
--    for anything but the helper. Rate-limit rows are a side-channel; users
--    must not be able to read or write them directly.
--
-- 6. app.bump_rate_limit() uses a per-profile-per-scope advisory lock to
--    serialise concurrent increments within a window; the UNIQUE
--    (profile_id, scope_key, window_start) index keeps row count bounded
--    to one per window and lets a later vacuum job delete old windows.
--
-- 7. The two dashboard queries for contact_requests - "provider inbox by
--    status" and "receiver outbox by date" - each get a partial index to
--    keep p99 tail latency bounded as volume grows.

-- =============================================================================
-- contact_requests
-- =============================================================================
create table if not exists public.contact_requests (
  id              uuid primary key default gen_random_uuid(),
  receiver_id     uuid not null references public.profiles(id) on delete cascade,
  provider_id     uuid not null references public.provider_profiles(id) on delete cascade,
  subject         text not null check (char_length(subject) between 3 and 120),
  body            text not null check (char_length(body) between 10 and 2000),
  status          text not null default 'pending'
                    check (status in ('pending','accepted','declined','expired','withdrawn')),
  responded_at    timestamptz,
  response_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists contact_requests_provider_inbox_idx
  on public.contact_requests (provider_id, status, created_at desc)
  where deleted_at is null;

create index if not exists contact_requests_receiver_outbox_idx
  on public.contact_requests (receiver_id, created_at desc)
  where deleted_at is null;

drop trigger if exists contact_requests_set_updated_at on public.contact_requests;
create trigger contact_requests_set_updated_at
before update on public.contact_requests
for each row execute function app.tg_set_updated_at();

-- Guard trigger. Enforces the legal status transitions because RLS cannot
-- compare OLD vs NEW. Also stamps responded_at on the transition.
create or replace function public.tg_contact_requests_guard()
returns trigger
language plpgsql
as $$
declare
  v_role public.app_role := app.current_role();
  v_me   uuid             := app.current_profile_id();
begin
  if v_role = 'admin'::public.app_role then
    return new;
  end if;

  -- Subject/body/receiver/provider are immutable on the owner path.
  if new.receiver_id is distinct from old.receiver_id
  or new.provider_id is distinct from old.provider_id
  or new.subject     is distinct from old.subject
  or new.body        is distinct from old.body then
    raise exception 'contact_requests core fields are immutable after insert'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- Receiver may withdraw a pending request.
    if v_me = old.receiver_id
       and old.status = 'pending'
       and new.status = 'withdrawn' then
      new.responded_at := coalesce(new.responded_at, now());
      return new;
    end if;

    -- Provider may accept or decline a pending request.
    if v_me = old.provider_id
       and old.status = 'pending'
       and new.status in ('accepted','declined') then
      new.responded_at := coalesce(new.responded_at, now());
      return new;
    end if;

    raise exception 'illegal contact_requests status transition: % -> % (by %)',
      old.status, new.status, v_me
      using errcode = '42501';
  end if;

  -- No status change: allow (e.g. soft-delete by owner).
  return new;
end;
$$;

drop trigger if exists tg_contact_requests_guard on public.contact_requests;
create trigger tg_contact_requests_guard
before update on public.contact_requests
for each row execute function public.tg_contact_requests_guard();

-- AFTER UPDATE: auto-create the contact_thread when the request flips to
-- accepted. SECURITY DEFINER so it can insert past contact_threads RLS.
create or replace function public.tg_contact_requests_open_thread()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if old.status is distinct from 'accepted'::text
     and new.status = 'accepted'::text then
    insert into public.contact_threads (id, contact_request_id)
    values (gen_random_uuid(), new.id)
    on conflict (contact_request_id) do nothing;
  end if;
  return new;
end;
$$;

-- Wire this AFTER contact_threads is created below.

alter table public.contact_requests enable row level security;

revoke all on public.contact_requests from anon, authenticated;
grant select, insert, update on public.contact_requests to authenticated;

drop policy if exists contact_requests_receiver_read on public.contact_requests;
create policy contact_requests_receiver_read
  on public.contact_requests
  for select
  to authenticated
  using (receiver_id = app.current_profile_id() and deleted_at is null);

drop policy if exists contact_requests_provider_read on public.contact_requests;
create policy contact_requests_provider_read
  on public.contact_requests
  for select
  to authenticated
  using (provider_id = app.current_profile_id() and deleted_at is null);

drop policy if exists contact_requests_admin on public.contact_requests;
create policy contact_requests_admin
  on public.contact_requests
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- Receiver (or family member) may create a request to a verified provider.
-- The caller's role is read from app.current_role(); the provider must be
-- verified and live. status is forced to pending.
drop policy if exists contact_requests_receiver_insert on public.contact_requests;
create policy contact_requests_receiver_insert
  on public.contact_requests
  for insert
  to authenticated
  with check (
    receiver_id = app.current_profile_id()
    and status = 'pending'
    and app.current_role() in ('receiver'::public.app_role, 'family_member'::public.app_role)
    and exists (
      select 1
      from public.provider_profiles pp
      where pp.id = contact_requests.provider_id
        and pp.verified_at is not null
        and pp.deleted_at is null
    )
  );

-- UPDATE policy: both parties may update their own rows (the guard trigger
-- enforces which transitions are legal). WITH CHECK keeps the ownership edge
-- enforced on the new row so you cannot hijack a row from one party to the
-- other via UPDATE.
drop policy if exists contact_requests_party_update on public.contact_requests;
create policy contact_requests_party_update
  on public.contact_requests
  for update
  to authenticated
  using (
    (receiver_id = app.current_profile_id() or provider_id = app.current_profile_id())
  )
  with check (
    (receiver_id = app.current_profile_id() or provider_id = app.current_profile_id())
  );

-- =============================================================================
-- meeting_proposals
-- =============================================================================
create table if not exists public.meeting_proposals (
  id                  uuid primary key default gen_random_uuid(),
  contact_request_id  uuid not null references public.contact_requests(id) on delete cascade,
  proposed_by         uuid not null references public.profiles(id),
  proposed_at         timestamptz not null default now(),
  meeting_at          timestamptz not null,
  duration_minutes    int not null check (duration_minutes between 15 and 240),
  location_mode       text not null check (location_mode in ('in_person','video','phone')),
  location_detail     text,
  status              text not null default 'proposed'
                         check (status in ('proposed','accepted','declined','cancelled')),
  responded_at        timestamptz,
  response_note       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists meeting_proposals_request_idx
  on public.meeting_proposals (contact_request_id, created_at desc)
  where deleted_at is null;

drop trigger if exists meeting_proposals_set_updated_at on public.meeting_proposals;
create trigger meeting_proposals_set_updated_at
before update on public.meeting_proposals
for each row execute function app.tg_set_updated_at();

-- BEFORE INSERT: reject meetings in the past. CHECK cannot reference now().
create or replace function public.tg_meeting_proposals_future_only()
returns trigger
language plpgsql
as $$
begin
  if new.meeting_at <= now() then
    raise exception 'meeting_at must be in the future'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_meeting_proposals_future_only on public.meeting_proposals;
create trigger tg_meeting_proposals_future_only
before insert on public.meeting_proposals
for each row execute function public.tg_meeting_proposals_future_only();

-- Guard trigger: only the OTHER party may transition proposed->accepted|
-- declined|cancelled; the proposer may transition proposed->cancelled.
create or replace function public.tg_meeting_proposals_guard()
returns trigger
language plpgsql
as $$
declare
  v_role public.app_role := app.current_role();
  v_me   uuid             := app.current_profile_id();
  v_cr   public.contact_requests%rowtype;
begin
  if v_role = 'admin'::public.app_role then
    return new;
  end if;

  if new.contact_request_id is distinct from old.contact_request_id
  or new.proposed_by        is distinct from old.proposed_by
  or new.proposed_at        is distinct from old.proposed_at
  or new.meeting_at         is distinct from old.meeting_at
  or new.duration_minutes   is distinct from old.duration_minutes
  or new.location_mode      is distinct from old.location_mode
  or new.location_detail    is distinct from old.location_detail then
    raise exception 'meeting_proposals core fields are immutable after insert'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    select * into v_cr from public.contact_requests where id = old.contact_request_id;

    if old.status <> 'proposed' then
      raise exception 'meeting_proposals status is terminal once it leaves proposed'
        using errcode = '42501';
    end if;

    -- Proposer may only cancel.
    if v_me = old.proposed_by then
      if new.status <> 'cancelled' then
        raise exception 'proposer may only cancel a proposal'
          using errcode = '42501';
      end if;
    else
      -- The counter-party must be a party on the underlying request.
      if v_me not in (v_cr.receiver_id, v_cr.provider_id) then
        raise exception 'only a party on the contact request may respond to a proposal'
          using errcode = '42501';
      end if;
      if new.status not in ('accepted','declined','cancelled') then
        raise exception 'illegal counter-party transition'
          using errcode = '42501';
      end if;
    end if;

    new.responded_at := coalesce(new.responded_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists tg_meeting_proposals_guard on public.meeting_proposals;
create trigger tg_meeting_proposals_guard
before update on public.meeting_proposals
for each row execute function public.tg_meeting_proposals_guard();

alter table public.meeting_proposals enable row level security;

revoke all on public.meeting_proposals from anon, authenticated;
grant select, insert, update on public.meeting_proposals to authenticated;

drop policy if exists meeting_proposals_party_read on public.meeting_proposals;
create policy meeting_proposals_party_read
  on public.meeting_proposals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.contact_requests cr
      where cr.id = meeting_proposals.contact_request_id
        and cr.status = 'accepted'
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

drop policy if exists meeting_proposals_party_insert on public.meeting_proposals;
create policy meeting_proposals_party_insert
  on public.meeting_proposals
  for insert
  to authenticated
  with check (
    proposed_by = app.current_profile_id()
    and status = 'proposed'
    and exists (
      select 1
      from public.contact_requests cr
      where cr.id = meeting_proposals.contact_request_id
        and cr.status = 'accepted'
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

drop policy if exists meeting_proposals_party_update on public.meeting_proposals;
create policy meeting_proposals_party_update
  on public.meeting_proposals
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.contact_requests cr
      where cr.id = meeting_proposals.contact_request_id
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  )
  with check (
    exists (
      select 1
      from public.contact_requests cr
      where cr.id = meeting_proposals.contact_request_id
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

drop policy if exists meeting_proposals_admin on public.meeting_proposals;
create policy meeting_proposals_admin
  on public.meeting_proposals
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- contact_threads
-- =============================================================================
create table if not exists public.contact_threads (
  id                  uuid primary key default gen_random_uuid(),
  contact_request_id  uuid not null unique references public.contact_requests(id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

drop trigger if exists contact_threads_set_updated_at on public.contact_threads;
create trigger contact_threads_set_updated_at
before update on public.contact_threads
for each row execute function app.tg_set_updated_at();

-- Now that contact_threads exists, wire the AFTER UPDATE trigger on
-- contact_requests that auto-opens a thread when the request is accepted.
drop trigger if exists tg_contact_requests_open_thread on public.contact_requests;
create trigger tg_contact_requests_open_thread
after update on public.contact_requests
for each row execute function public.tg_contact_requests_open_thread();

alter table public.contact_threads enable row level security;

revoke all on public.contact_threads from anon, authenticated;
grant select on public.contact_threads to authenticated;
-- No INSERT / UPDATE / DELETE grant for authenticated. Threads are only
-- created by the SECURITY DEFINER trigger on contact_requests; admin ops
-- go through the admin policy plus a direct grant below.

drop policy if exists contact_threads_party_read on public.contact_threads;
create policy contact_threads_party_read
  on public.contact_threads
  for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.contact_requests cr
      where cr.id = contact_threads.contact_request_id
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

drop policy if exists contact_threads_admin on public.contact_threads;
create policy contact_threads_admin
  on public.contact_threads
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- Admin needs write grants for the admin policy to actually bite.
grant insert, update, delete on public.contact_threads to authenticated;

-- =============================================================================
-- rate_limit_buckets + app.bump_rate_limit
-- =============================================================================
create table if not exists public.rate_limit_buckets (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid references public.profiles(id) on delete cascade,
  scope_key       text not null,
  window_start    timestamptz not null,
  window_seconds  int not null check (window_seconds > 0),
  count           int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint rate_limit_buckets_scope_window_unique
    unique (profile_id, scope_key, window_start)
);

create index if not exists rate_limit_buckets_window_idx
  on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;

-- Deliberately zero grants and zero policies for anon + authenticated. All
-- access goes through app.bump_rate_limit() which is SECURITY DEFINER.
revoke all on public.rate_limit_buckets from anon, authenticated;

create or replace function app.bump_rate_limit(
  p_scope          text,
  p_window_seconds int,
  p_max_count      int
)
returns int
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_profile      uuid := app.current_profile_id();
  v_window_start timestamptz;
  v_count        int;
begin
  if v_profile is null then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            detail  = 'no authenticated profile';
  end if;

  -- Align the window to a deterministic boundary so all callers within the
  -- same window share the same bucket row.
  v_window_start := to_timestamp(
    (floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)::double precision
  );

  -- Serialise concurrent bumps for this (profile, scope).
  perform pg_advisory_xact_lock(
    hashtext(v_profile::text || '|' || p_scope)
  );

  insert into public.rate_limit_buckets
    (profile_id, scope_key, window_start, window_seconds, count)
  values
    (v_profile, p_scope, v_window_start, p_window_seconds, 1)
  on conflict (profile_id, scope_key, window_start)
    do update set count = public.rate_limit_buckets.count + 1,
                  updated_at = now()
  returning count into v_count;

  if v_count > p_max_count then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            detail  = format('scope=%s window=%ss count=%s max=%s',
                             p_scope, p_window_seconds, v_count, p_max_count);
  end if;

  return v_count;
end;
$$;

grant execute on function app.bump_rate_limit(text, int, int) to authenticated;

-- =============================================================================
-- contact_thread_posts
-- =============================================================================
create table if not exists public.contact_thread_posts (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.contact_threads(id) on delete cascade,
  author_id   uuid not null references public.profiles(id),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

create index if not exists contact_thread_posts_thread_idx
  on public.contact_thread_posts (thread_id, created_at);

-- BEFORE INSERT rate-limit bump. Placed on the insert path so every caller
-- path (Server Action, future bulk import, whatever) goes through it.
create or replace function public.tg_contact_thread_posts_rate_limit()
returns trigger
language plpgsql
as $$
begin
  -- 30 posts per minute per author. Upper bound, not a UX floor - tune later.
  perform app.bump_rate_limit('thread_post.create', 60, 30);
  return new;
end;
$$;

drop trigger if exists tg_contact_thread_posts_rate_limit on public.contact_thread_posts;
create trigger tg_contact_thread_posts_rate_limit
before insert on public.contact_thread_posts
for each row execute function public.tg_contact_thread_posts_rate_limit();

alter table public.contact_thread_posts enable row level security;

revoke all on public.contact_thread_posts from anon, authenticated;
grant select, insert on public.contact_thread_posts to authenticated;
-- No UPDATE / DELETE grant. Posts are immutable from user code.

drop policy if exists contact_thread_posts_party_read on public.contact_thread_posts;
create policy contact_thread_posts_party_read
  on public.contact_thread_posts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.contact_threads t
      join public.contact_requests cr on cr.id = t.contact_request_id
      where t.id = contact_thread_posts.thread_id
        and t.deleted_at is null
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

drop policy if exists contact_thread_posts_party_insert on public.contact_thread_posts;
create policy contact_thread_posts_party_insert
  on public.contact_thread_posts
  for insert
  to authenticated
  with check (
    author_id = app.current_profile_id()
    and exists (
      select 1
      from public.contact_threads t
      join public.contact_requests cr on cr.id = t.contact_request_id
      where t.id = contact_thread_posts.thread_id
        and t.deleted_at is null
        and cr.status = 'accepted'
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

drop policy if exists contact_thread_posts_admin on public.contact_thread_posts;
create policy contact_thread_posts_admin
  on public.contact_thread_posts
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);
