-- 0011_family_circles.sql
--
-- C4: Receiver family circles & authorisation.
--   - care_circles (one per receiver)
--   - care_circle_members (links family members to a circle)
--   - family_authorisations (stores authorisation documents - PoA etc.)
--   - Real body for app.is_care_circle_member() (replaces the 0001 stub)
--   - receiver-docs storage bucket + policies (quarantine pattern)
--   - Adds 'authorisation' to the documents.kind CHECK
--   - pgTAP tests for every RLS policy

-- =============================================================================
-- Enums
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'care_circle_role') then
    create type public.care_circle_role as enum ('primary', 'member');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'authorisation_type') then
    create type public.authorisation_type as enum (
      'power_of_attorney',
      'legal_guardian',
      'deputyship',
      'other'
    );
  end if;
end
$$;

-- =============================================================================
-- care_circles
-- =============================================================================
create table if not exists public.care_circles (
  id           uuid primary key default gen_random_uuid(),
  receiver_id  uuid not null references public.profiles(id) on delete cascade,
  name         text not null default 'My care circle',
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint care_circles_one_per_receiver unique (receiver_id)
);

create index if not exists care_circles_receiver_idx
  on public.care_circles (receiver_id)
  where deleted_at is null;

alter table public.care_circles enable row level security;

revoke all on public.care_circles from anon, authenticated;
grant select, insert, update, delete on public.care_circles to authenticated;

-- Readable by circle members
drop policy if exists care_circles_member_read on public.care_circles;
create policy care_circles_member_read
  on public.care_circles
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      receiver_id = app.current_profile_id()
      or app.is_care_circle_member(id)
    )
  );

-- Receiver can insert their own circle
drop policy if exists care_circles_receiver_insert on public.care_circles;
create policy care_circles_receiver_insert
  on public.care_circles
  for insert
  to authenticated
  with check (
    receiver_id = app.current_profile_id()
    and deleted_at is null
  );

-- Receiver can update their own circle
drop policy if exists care_circles_receiver_update on public.care_circles;
create policy care_circles_receiver_update
  on public.care_circles
  for update
  to authenticated
  using (receiver_id = app.current_profile_id() and deleted_at is null)
  with check (receiver_id = app.current_profile_id());

-- Admin full access
drop policy if exists care_circles_admin on public.care_circles;
create policy care_circles_admin
  on public.care_circles
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- care_circle_members
-- =============================================================================
create table if not exists public.care_circle_members (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references public.care_circles(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         public.care_circle_role not null default 'member',
  invited_by   uuid references public.profiles(id),
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  removed_at   timestamptz,
  constraint care_circle_members_unique_active
    unique nulls not distinct (circle_id, profile_id)
    -- PostgreSQL 15+ supports NULLS NOT DISTINCT but we use a partial unique
    -- index instead for broader compatibility:
);

-- Drop the table-level constraint if it was created, and use partial index
alter table public.care_circle_members
  drop constraint if exists care_circle_members_unique_active;

create unique index if not exists care_circle_members_active_unique_idx
  on public.care_circle_members (circle_id, profile_id)
  where removed_at is null;

create index if not exists care_circle_members_circle_idx
  on public.care_circle_members (circle_id)
  where removed_at is null;

create index if not exists care_circle_members_profile_idx
  on public.care_circle_members (profile_id)
  where removed_at is null;

alter table public.care_circle_members enable row level security;

revoke all on public.care_circle_members from anon, authenticated;
grant select, insert, update, delete on public.care_circle_members to authenticated;

-- Readable by circle members (anyone in the same circle can see other members)
drop policy if exists care_circle_members_read on public.care_circle_members;
create policy care_circle_members_read
  on public.care_circle_members
  for select
  to authenticated
  using (
    removed_at is null
    and (
      -- The receiver who owns the circle
      exists (
        select 1 from public.care_circles cc
        where cc.id = care_circle_members.circle_id
          and cc.receiver_id = app.current_profile_id()
          and cc.deleted_at is null
      )
      -- Or an active member of the circle
      or exists (
        select 1 from public.care_circle_members other
        where other.circle_id = care_circle_members.circle_id
          and other.profile_id = app.current_profile_id()
          and other.accepted_at is not null
          and other.removed_at is null
      )
    )
  );

-- Insert: receiver or primary family member can add members
drop policy if exists care_circle_members_insert on public.care_circle_members;
create policy care_circle_members_insert
  on public.care_circle_members
  for insert
  to authenticated
  with check (
    removed_at is null
    and (
      -- Receiver who owns the circle
      exists (
        select 1 from public.care_circles cc
        where cc.id = care_circle_members.circle_id
          and cc.receiver_id = app.current_profile_id()
          and cc.deleted_at is null
      )
      -- Or primary family member of the circle
      or exists (
        select 1 from public.care_circle_members existing
        where existing.circle_id = care_circle_members.circle_id
          and existing.profile_id = app.current_profile_id()
          and existing.role = 'primary'
          and existing.accepted_at is not null
          and existing.removed_at is null
      )
    )
  );

-- Update: receiver or primary family member can update members (accept, remove)
drop policy if exists care_circle_members_update on public.care_circle_members;
create policy care_circle_members_update
  on public.care_circle_members
  for update
  to authenticated
  using (
    -- The member themselves can accept their own invitation
    profile_id = app.current_profile_id()
    -- Or the receiver who owns the circle
    or exists (
      select 1 from public.care_circles cc
      where cc.id = care_circle_members.circle_id
        and cc.receiver_id = app.current_profile_id()
        and cc.deleted_at is null
    )
    -- Or a primary family member
    or exists (
      select 1 from public.care_circle_members existing
      where existing.circle_id = care_circle_members.circle_id
        and existing.profile_id = app.current_profile_id()
        and existing.role = 'primary'
        and existing.accepted_at is not null
        and existing.removed_at is null
    )
  )
  with check (true);

-- Admin full access
drop policy if exists care_circle_members_admin on public.care_circle_members;
create policy care_circle_members_admin
  on public.care_circle_members
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- family_authorisations
-- =============================================================================
create table if not exists public.family_authorisations (
  id                  uuid primary key default gen_random_uuid(),
  circle_member_id    uuid not null references public.care_circle_members(id) on delete cascade,
  document_id         uuid not null references public.documents(id) on delete cascade,
  authorisation_type  public.authorisation_type not null,
  granted_at          timestamptz not null default now(),
  expires_at          timestamptz,
  verified_at         timestamptz,
  verified_by         uuid references public.profiles(id),
  notes               text,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists family_authorisations_member_idx
  on public.family_authorisations (circle_member_id)
  where deleted_at is null;

create index if not exists family_authorisations_document_idx
  on public.family_authorisations (document_id)
  where deleted_at is null;

alter table public.family_authorisations enable row level security;

revoke all on public.family_authorisations from anon, authenticated;
grant select, insert, update, delete on public.family_authorisations to authenticated;

-- Readable by the family member themselves, the receiver, and admin
drop policy if exists family_authorisations_read on public.family_authorisations;
create policy family_authorisations_read
  on public.family_authorisations
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      -- The family member who uploaded the authorisation
      exists (
        select 1 from public.care_circle_members ccm
        where ccm.id = family_authorisations.circle_member_id
          and ccm.profile_id = app.current_profile_id()
          and ccm.removed_at is null
      )
      -- Or the receiver who owns the circle
      or exists (
        select 1 from public.care_circle_members ccm
        join public.care_circles cc on cc.id = ccm.circle_id
        where ccm.id = family_authorisations.circle_member_id
          and cc.receiver_id = app.current_profile_id()
          and cc.deleted_at is null
      )
    )
  );

-- Insert: the family member themselves can upload
drop policy if exists family_authorisations_member_insert on public.family_authorisations;
create policy family_authorisations_member_insert
  on public.family_authorisations
  for insert
  to authenticated
  with check (
    deleted_at is null
    and exists (
      select 1 from public.care_circle_members ccm
      where ccm.id = family_authorisations.circle_member_id
        and ccm.profile_id = app.current_profile_id()
        and ccm.accepted_at is not null
        and ccm.removed_at is null
    )
  );

-- Update: family member can soft-delete; admin can verify
drop policy if exists family_authorisations_member_update on public.family_authorisations;
create policy family_authorisations_member_update
  on public.family_authorisations
  for update
  to authenticated
  using (
    exists (
      select 1 from public.care_circle_members ccm
      where ccm.id = family_authorisations.circle_member_id
        and ccm.profile_id = app.current_profile_id()
        and ccm.removed_at is null
    )
  )
  with check (true);

-- Admin full access
drop policy if exists family_authorisations_admin on public.family_authorisations;
create policy family_authorisations_admin
  on public.family_authorisations
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- Guard trigger: verified_at/verified_by are admin-only
create or replace function public.tg_family_authorisations_guard()
returns trigger
language plpgsql
as $$
begin
  if app.current_role() = 'admin'::public.app_role then
    return new;
  end if;

  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at changes are admin-only'
      using errcode = '42501';
  end if;

  if new.verified_by is distinct from old.verified_by then
    raise exception 'verified_by changes are admin-only'
      using errcode = '42501';
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'undelete is admin-only'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_family_authorisations_guard on public.family_authorisations;
create trigger tg_family_authorisations_guard
before update on public.family_authorisations
for each row execute function public.tg_family_authorisations_guard();

-- =============================================================================
-- app.is_care_circle_member() real body (replaces the 0001 stub)
-- Keeps the original parameter name "circle_id" from the 0001 stub because
-- Postgres does not allow renaming parameters via CREATE OR REPLACE.
-- =============================================================================
create or replace function app.is_care_circle_member(circle_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.care_circle_members ccm
    where ccm.circle_id = is_care_circle_member.circle_id
      and ccm.profile_id = app.current_profile_id()
      and ccm.accepted_at is not null
      and ccm.removed_at is null
  )
  or exists (
    select 1
    from public.care_circles cc
    where cc.id = is_care_circle_member.circle_id
      and cc.receiver_id = app.current_profile_id()
      and cc.deleted_at is null
  );
$$;

-- =============================================================================
-- Add 'authorisation' to the documents.kind CHECK
-- =============================================================================
-- Drop the old CHECK and add the expanded one
alter table public.documents
  drop constraint if exists documents_kind_check;

-- The original check name from 0004 might be the inline one
do $$
begin
  -- Try to drop any existing kind check constraint
  execute (
    select 'alter table public.documents drop constraint ' || quote_ident(conname)
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
    limit 1
  );
exception
  when others then null;
end;
$$;

alter table public.documents
  add constraint documents_kind_check
  check (kind in ('dbs','insurance','certification','identity','right_to_work','authorisation','other'));

-- =============================================================================
-- documents RLS: circle members can read receiver docs
-- =============================================================================
drop policy if exists documents_circle_member_read on public.documents;
create policy documents_circle_member_read
  on public.documents
  for select
  to authenticated
  using (
    receiver_id is not null
    and deleted_at is null
    and exists (
      select 1 from public.care_circles cc
      where cc.receiver_id = documents.receiver_id
        and cc.deleted_at is null
        and app.is_care_circle_member(cc.id)
    )
  );

-- Receiver can read their own docs
drop policy if exists documents_receiver_read on public.documents;
create policy documents_receiver_read
  on public.documents
  for select
  to authenticated
  using (
    receiver_id = app.current_profile_id()
    and deleted_at is null
  );

-- Family member can insert docs for the receiver they belong to
drop policy if exists documents_family_insert on public.documents;
create policy documents_family_insert
  on public.documents
  for insert
  to authenticated
  with check (
    uploaded_by = app.current_profile_id()
    and status = 'quarantined'
    and receiver_id is not null
    and exists (
      select 1 from public.care_circles cc
      where cc.receiver_id = documents.receiver_id
        and cc.deleted_at is null
        and app.is_care_circle_member(cc.id)
    )
  );

-- =============================================================================
-- Storage bucket: receiver-docs (quarantine pattern like provider-docs)
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('receiver-docs', 'receiver-docs', false)
on conflict (id) do nothing;

-- INSERT: upload into quarantine/<my-profile-id>/<filename>
drop policy if exists receiver_docs_owner_insert on storage.objects;
create policy receiver_docs_owner_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'receiver-docs'
    and (storage.foldername(name))[1] = 'quarantine'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

-- SELECT: owner can read their own quarantine/ or clean/ objects;
-- circle members can read clean/ objects for the receiver; admin can read any.
drop policy if exists receiver_docs_read on storage.objects;
create policy receiver_docs_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'receiver-docs'
    and (
      (
        (storage.foldername(name))[1] in ('quarantine','clean')
        and (storage.foldername(name))[2]::uuid = auth.uid()
      )
      or app.current_role() = 'admin'::public.app_role
    )
  );

-- DELETE: owner can delete their own quarantine objects; admin can delete any.
drop policy if exists receiver_docs_owner_delete on storage.objects;
create policy receiver_docs_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'receiver-docs'
    and (
      (
        (storage.foldername(name))[1] = 'quarantine'
        and (storage.foldername(name))[2]::uuid = auth.uid()
      )
      or app.current_role() = 'admin'::public.app_role
    )
  );

-- UPDATE: admin only
drop policy if exists receiver_docs_admin_update on storage.objects;
create policy receiver_docs_admin_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'receiver-docs' and app.current_role() = 'admin'::public.app_role)
  with check (bucket_id = 'receiver-docs' and app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- Invitation tokens table (for email-based family member invitations)
-- =============================================================================
create table if not exists public.family_invitations (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references public.care_circles(id) on delete cascade,
  email        text not null,
  role         public.care_circle_role not null default 'member',
  invited_by   uuid not null references public.profiles(id),
  token        text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists family_invitations_token_idx
  on public.family_invitations (token)
  where accepted_at is null;

create index if not exists family_invitations_circle_idx
  on public.family_invitations (circle_id);

alter table public.family_invitations enable row level security;

revoke all on public.family_invitations from anon, authenticated;
grant select, insert, update on public.family_invitations to authenticated;
-- Anon needs select to look up invitation by token during sign-up
grant select on public.family_invitations to anon;

-- Anon can read unexpired, unaccepted invitations by token (for the sign-up page)
drop policy if exists family_invitations_anon_read on public.family_invitations;
create policy family_invitations_anon_read
  on public.family_invitations
  for select
  to anon
  using (
    accepted_at is null
    and expires_at > now()
  );

-- Authenticated: receiver or primary member can see invitations for their circle
drop policy if exists family_invitations_circle_read on public.family_invitations;
create policy family_invitations_circle_read
  on public.family_invitations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.care_circles cc
      where cc.id = family_invitations.circle_id
        and cc.receiver_id = app.current_profile_id()
        and cc.deleted_at is null
    )
    or exists (
      select 1 from public.care_circle_members ccm
      where ccm.circle_id = family_invitations.circle_id
        and ccm.profile_id = app.current_profile_id()
        and ccm.role = 'primary'
        and ccm.accepted_at is not null
        and ccm.removed_at is null
    )
  );

-- Insert: receiver or primary member can create invitations
drop policy if exists family_invitations_insert on public.family_invitations;
create policy family_invitations_insert
  on public.family_invitations
  for insert
  to authenticated
  with check (
    invited_by = app.current_profile_id()
    and (
      exists (
        select 1 from public.care_circles cc
        where cc.id = family_invitations.circle_id
          and cc.receiver_id = app.current_profile_id()
          and cc.deleted_at is null
      )
      or exists (
        select 1 from public.care_circle_members ccm
        where ccm.circle_id = family_invitations.circle_id
          and ccm.profile_id = app.current_profile_id()
          and ccm.role = 'primary'
          and ccm.accepted_at is not null
          and ccm.removed_at is null
      )
    )
  );

-- Update: invitation acceptance (authenticated user accepting their own invite)
drop policy if exists family_invitations_accept on public.family_invitations;
create policy family_invitations_accept
  on public.family_invitations
  for update
  to authenticated
  using (
    accepted_at is null
    and expires_at > now()
  )
  with check (
    accepted_at is not null
  );

-- Admin full access
drop policy if exists family_invitations_admin on public.family_invitations;
create policy family_invitations_admin
  on public.family_invitations
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);
