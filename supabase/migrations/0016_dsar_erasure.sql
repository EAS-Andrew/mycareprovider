-- 0016_dsar_erasure.sql
--
-- C24 anchor. Data Subject Access Rights (DSAR) and right-to-erasure tables
-- required for UK GDPR compliance.
--
-- Two tables:
--
--   - dsar_requests   : tracks data-export and erasure requests from users.
--                       Only the requester can INSERT (one pending per user,
--                       enforced by a unique partial index). Admin manages
--                       status transitions.
--
--   - erasure_requests: child of dsar_requests for erasure-type requests.
--                       Tracks 30-day cool-off, legal holds, and admin
--                       processing. Only created when request_type = 'erasure'.
--
-- DESIGN NOTES
-- ------------
-- 1. Enums are CHECK constraints (not CREATE TYPE) to match the codebase
--    pattern in contact_requests, documents, etc.
--
-- 2. The 30-day cool-off is computed at INSERT time as
--    cooloff_ends_at = now() + interval '30 days'.
--
-- 3. Soft-delete cascade (the actual erasure) sets deleted_at on all
--    user-owned rows across regulated tables. This is triggered by an admin
--    Server Action after cool-off expires, not by a database trigger, so the
--    admin can inspect legal holds first.
--
-- 4. audit_log is NEVER deleted (append-only, exempt from erasure).
--    Safeguarding records (C25) are also exempt.
--
-- 5. After cool-off + admin confirmation, a scheduled job hard-deletes rows
--    where deleted_at is set and no legal hold applies. Care records and
--    financial records have statutory retention holds and are NOT erased.

-- =============================================================================
-- dsar_requests
-- =============================================================================
create table if not exists public.dsar_requests (
  id                uuid primary key default gen_random_uuid(),
  requester_id      uuid not null references public.profiles(id) on delete cascade,
  request_type      text not null
                      check (request_type in ('access', 'erasure')),
  status            text not null default 'pending'
                      check (status in ('pending', 'processing', 'completed', 'rejected')),
  requested_at      timestamptz not null default now(),
  processed_at      timestamptz,
  processed_by      uuid references public.profiles(id),
  download_url      text,
  download_expires_at timestamptz,
  rejection_reason  text,
  notes             text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- One pending request of each type per user at a time.
create unique index if not exists dsar_requests_one_pending_per_user_idx
  on public.dsar_requests (requester_id, request_type)
  where status = 'pending' and deleted_at is null;

create index if not exists dsar_requests_requester_idx
  on public.dsar_requests (requester_id, created_at desc)
  where deleted_at is null;

create index if not exists dsar_requests_status_idx
  on public.dsar_requests (status, created_at asc)
  where deleted_at is null;

-- =============================================================================
-- erasure_requests
-- =============================================================================
create table if not exists public.erasure_requests (
  id                uuid primary key default gen_random_uuid(),
  dsar_request_id   uuid not null references public.dsar_requests(id) on delete cascade,
  requester_id      uuid not null references public.profiles(id) on delete cascade,
  status            text not null default 'pending_cooloff'
                      check (status in (
                        'pending_cooloff',
                        'cooloff_expired',
                        'processing',
                        'completed',
                        'cancelled'
                      )),
  cooloff_ends_at   timestamptz not null default (now() + interval '30 days'),
  legal_holds       jsonb not null default '[]'::jsonb,
  processed_at      timestamptz,
  processed_by      uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);

create index if not exists erasure_requests_requester_idx
  on public.erasure_requests (requester_id, created_at desc);

create index if not exists erasure_requests_cooloff_idx
  on public.erasure_requests (status, cooloff_ends_at asc)
  where status = 'pending_cooloff';

-- =============================================================================
-- RLS: dsar_requests
-- =============================================================================
alter table public.dsar_requests enable row level security;

revoke all on public.dsar_requests from anon, authenticated;
grant select, insert on public.dsar_requests to authenticated;
grant update on public.dsar_requests to authenticated;

-- Requester can read their own rows.
drop policy if exists dsar_requests_self_select on public.dsar_requests;
create policy dsar_requests_self_select
  on public.dsar_requests
  for select
  to authenticated
  using (
    requester_id = app.current_profile_id()
    and deleted_at is null
  );

-- Admin can read all rows.
drop policy if exists dsar_requests_admin_select on public.dsar_requests;
create policy dsar_requests_admin_select
  on public.dsar_requests
  for select
  to authenticated
  using (
    app.current_role() = 'admin'::public.app_role
    and deleted_at is null
  );

-- Only the requester can insert, and only for themselves.
drop policy if exists dsar_requests_self_insert on public.dsar_requests;
create policy dsar_requests_self_insert
  on public.dsar_requests
  for insert
  to authenticated
  with check (
    requester_id = app.current_profile_id()
  );

-- Only admin can update (status transitions).
drop policy if exists dsar_requests_admin_update on public.dsar_requests;
create policy dsar_requests_admin_update
  on public.dsar_requests
  for update
  to authenticated
  using (
    app.current_role() = 'admin'::public.app_role
    and deleted_at is null
  )
  with check (
    app.current_role() = 'admin'::public.app_role
  );

-- =============================================================================
-- RLS: erasure_requests
-- =============================================================================
alter table public.erasure_requests enable row level security;

revoke all on public.erasure_requests from anon, authenticated;
grant select, insert on public.erasure_requests to authenticated;
grant update on public.erasure_requests to authenticated;

-- Requester can read their own rows.
drop policy if exists erasure_requests_self_select on public.erasure_requests;
create policy erasure_requests_self_select
  on public.erasure_requests
  for select
  to authenticated
  using (
    requester_id = app.current_profile_id()
  );

-- Admin can read all rows.
drop policy if exists erasure_requests_admin_select on public.erasure_requests;
create policy erasure_requests_admin_select
  on public.erasure_requests
  for select
  to authenticated
  using (
    app.current_role() = 'admin'::public.app_role
  );

-- Only the requester can insert, and only for themselves.
drop policy if exists erasure_requests_self_insert on public.erasure_requests;
create policy erasure_requests_self_insert
  on public.erasure_requests
  for insert
  to authenticated
  with check (
    requester_id = app.current_profile_id()
  );

-- Only admin can update (status transitions, processing).
drop policy if exists erasure_requests_admin_update on public.erasure_requests;
create policy erasure_requests_admin_update
  on public.erasure_requests
  for update
  to authenticated
  using (
    app.current_role() = 'admin'::public.app_role
  )
  with check (
    app.current_role() = 'admin'::public.app_role
  );

-- =============================================================================
-- Storage bucket for DSAR export bundles
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('dsar-exports', 'dsar-exports', false)
on conflict (id) do nothing;

-- Only admin (service role) uploads to dsar-exports; signed URLs for download.
-- No RLS policies needed - the bucket is private and accessed via signed URLs
-- generated by the admin client.
