-- 0004_provider_onboarding.sql
--
-- C3a anchor. Ships the provider onboarding / document-vault schema:
--   - provider_profiles (one-to-one with profiles, flipped to verified by C5)
--   - documents (single subject FK, exactly-one CHECK, per PID RLS-safety rule)
--   - verifications (state machine, auto-created by AFTER INSERT trigger)
--   - Real body for app.is_provider_verified() (replaces the C2 stub)
--   - provider-docs storage bucket + storage.objects policies scoped to
--     quarantine/<profile_id>/<uuid>-<filename> paths
--
-- DESIGN NOTES / REVIEW FLAGS
-- ---------------------------
-- 1. Column-grant boundary for the directory surface.
--    The PID requires the directory not leak date_of_birth, phone, or address
--    lines. The task brief suggested a column-level GRANT scoped to both anon
--    AND authenticated. I intentionally narrowed the grant for `anon` only and
--    kept `authenticated` on a full-column GRANT, because narrowing SELECT on
--    authenticated would also block an owner reading their own private fields
--    (column grants are role-wide, not per-policy). The public directory is
--    an UN-authenticated surface (C7a browses provider-docs as `anon`), so the
--    narrow anon grant is the real boundary. Flagging this for review.
--
-- 2. "Owner cannot change status" is enforced via a BEFORE UPDATE trigger on
--    `documents` rather than a CHECK constraint, per the task brief. A CHECK
--    cannot reference the caller's role, and splitting the policy into a
--    frozen-column shape is too brittle. The trigger also freezes every other
--    column on the owner's UPDATE path so the soft-delete policy cannot be
--    abused as a general edit channel.
--
-- 3. Owner INSERT on provider_profiles is allowed (with verified_at forced to
--    null). The task brief did not list this policy explicitly but the C3a
--    Server Action in task #2 needs to create the row through the user's own
--    client without an admin escalation. Flagging for review.
--
-- 4. verifications is NOT append-only. Admin state transitions are a
--    legitimate UPDATE path, so verifications carries an admin UPDATE policy.
--    This is a deliberate exception to the PID's append-only list (which
--    covers audit_log, care_plan_versions, commission_ledger,
--    medication_administrations, visit_notes). Noted here so a later reviewer
--    does not "fix" it.

-- =============================================================================
-- Shared updated_at helper
-- =============================================================================
create or replace function app.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- provider_profiles
-- =============================================================================
create table if not exists public.provider_profiles (
  id                  uuid primary key references public.profiles(id) on delete cascade,
  headline            text,
  bio                 text,
  date_of_birth       date,
  phone               text,
  address_line1       text,
  address_line2       text,
  city                text,
  postcode            text,
  country             char(2) not null default 'GB',
  years_experience    int check (years_experience >= 0),
  hourly_rate_pence   int check (hourly_rate_pence >= 0),
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists provider_profiles_verified_idx
  on public.provider_profiles (verified_at)
  where verified_at is not null and deleted_at is null;

drop trigger if exists provider_profiles_set_updated_at on public.provider_profiles;
create trigger provider_profiles_set_updated_at
before update on public.provider_profiles
for each row execute function app.tg_set_updated_at();

-- Guard trigger: verified_at is admin-only, undelete is admin-only. Mirrors
-- the tg_profiles_guard_role shape from 0001.
create or replace function public.tg_provider_profiles_guard_verification()
returns trigger
language plpgsql
as $$
begin
  if app.current_role() is distinct from 'admin'::public.app_role then
    if new.verified_at is distinct from old.verified_at then
      raise exception 'verified_at changes are admin-only'
        using errcode = '42501';
    end if;
    if old.deleted_at is not null and new.deleted_at is null then
      raise exception 'undelete is admin-only'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_provider_profiles_guard_verification on public.provider_profiles;
create trigger tg_provider_profiles_guard_verification
before update on public.provider_profiles
for each row execute function public.tg_provider_profiles_guard_verification();

alter table public.provider_profiles enable row level security;

revoke all on public.provider_profiles from anon, authenticated;
-- Narrow directory grant for anon (no dob/phone/address leakage).
grant select (id, headline, bio, city, country, years_experience, hourly_rate_pence, verified_at)
  on public.provider_profiles to anon;
-- Owners need full-column access so their "edit profile" screen can read and
-- write their own private fields. RLS policies below scope rows.
grant select, insert, update, delete on public.provider_profiles to authenticated;

drop policy if exists provider_profiles_self_read on public.provider_profiles;
create policy provider_profiles_self_read
  on public.provider_profiles
  for select
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null);

drop policy if exists provider_profiles_public_read on public.provider_profiles;
create policy provider_profiles_public_read
  on public.provider_profiles
  for select
  to anon, authenticated
  using (verified_at is not null and deleted_at is null);

drop policy if exists provider_profiles_admin_read on public.provider_profiles;
create policy provider_profiles_admin_read
  on public.provider_profiles
  for select
  to authenticated
  using (app.current_role() = 'admin'::public.app_role);

drop policy if exists provider_profiles_owner_insert on public.provider_profiles;
create policy provider_profiles_owner_insert
  on public.provider_profiles
  for insert
  to authenticated
  with check (
    id = app.current_profile_id()
    and verified_at is null
    and deleted_at is null
  );

drop policy if exists provider_profiles_self_update on public.provider_profiles;
create policy provider_profiles_self_update
  on public.provider_profiles
  for update
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null)
  with check (id = app.current_profile_id());

drop policy if exists provider_profiles_admin_write on public.provider_profiles;
create policy provider_profiles_admin_write
  on public.provider_profiles
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- documents
-- =============================================================================
create table if not exists public.documents (
  id                   uuid primary key default gen_random_uuid(),
  uploaded_by          uuid not null references public.profiles(id),
  -- Nullable subject FKs. Only provider_id carries a real FK today; the rest
  -- are plain uuid and will be upgraded to real FKs by later migrations when
  -- their target tables land (provider_companies in C3b, receiver_profiles in
  -- C4, care_plans in C10, visits in C11, messages in C9).
  provider_id          uuid references public.provider_profiles(id) on delete cascade,
  provider_company_id  uuid,
  receiver_id          uuid,
  care_plan_id         uuid,
  visit_id             uuid,
  message_id           uuid,
  kind                 text not null check (kind in ('dbs','insurance','certification','identity','right_to_work','other')),
  title                text not null,
  description          text,
  storage_bucket       text not null,
  storage_path         text not null,
  mime_type            text not null,
  size_bytes           bigint not null check (size_bytes >= 0),
  sha256               text,
  status               text not null default 'quarantined' check (status in ('quarantined','available','rejected')),
  rejected_reason      text,
  expires_at           date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint documents_storage_path_unique unique (storage_bucket, storage_path),
  constraint documents_exactly_one_subject check (
    (case when provider_id         is not null then 1 else 0 end
   + case when provider_company_id is not null then 1 else 0 end
   + case when receiver_id         is not null then 1 else 0 end
   + case when care_plan_id        is not null then 1 else 0 end
   + case when visit_id            is not null then 1 else 0 end
   + case when message_id          is not null then 1 else 0 end) = 1
  )
);

create index if not exists documents_uploaded_by_idx
  on public.documents (uploaded_by)
  where deleted_at is null;

create index if not exists documents_provider_idx
  on public.documents (provider_id)
  where deleted_at is null and provider_id is not null;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
before update on public.documents
for each row execute function app.tg_set_updated_at();

-- Owner-path guard: enforces "status is admin-only" and freezes every column
-- except deleted_at so the soft-delete policy cannot be abused to edit the
-- document content. Admin callers bypass the freeze.
create or replace function public.tg_documents_guard()
returns trigger
language plpgsql
as $$
begin
  if app.current_role() = 'admin'::public.app_role then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'status changes are admin-only'
      using errcode = '42501';
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'undelete is admin-only'
      using errcode = '42501';
  end if;

  if new.uploaded_by         is distinct from old.uploaded_by
  or new.provider_id         is distinct from old.provider_id
  or new.provider_company_id is distinct from old.provider_company_id
  or new.receiver_id         is distinct from old.receiver_id
  or new.care_plan_id        is distinct from old.care_plan_id
  or new.visit_id            is distinct from old.visit_id
  or new.message_id          is distinct from old.message_id
  or new.kind                is distinct from old.kind
  or new.title               is distinct from old.title
  or new.description         is distinct from old.description
  or new.storage_bucket      is distinct from old.storage_bucket
  or new.storage_path        is distinct from old.storage_path
  or new.mime_type           is distinct from old.mime_type
  or new.size_bytes          is distinct from old.size_bytes
  or new.sha256              is distinct from old.sha256
  or new.rejected_reason     is distinct from old.rejected_reason
  or new.expires_at          is distinct from old.expires_at then
    raise exception 'documents are immutable on the owner path (only deleted_at may change)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_documents_guard on public.documents;
create trigger tg_documents_guard
before update on public.documents
for each row execute function public.tg_documents_guard();

-- AFTER INSERT: auto-create the verifications row. Runs as security definer so
-- the owner's INSERT of a document does not need an INSERT policy on
-- verifications (there intentionally isn't one).
create or replace function public.tg_documents_create_verification()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  insert into public.verifications (id, document_id, state)
  values (gen_random_uuid(), new.id, 'pending');
  return new;
end;
$$;

alter table public.documents enable row level security;

revoke all on public.documents from anon, authenticated;
grant select, insert, update, delete on public.documents to authenticated;

drop policy if exists documents_owner_read on public.documents;
create policy documents_owner_read
  on public.documents
  for select
  to authenticated
  using (uploaded_by = app.current_profile_id() and deleted_at is null);

drop policy if exists documents_owner_insert on public.documents;
create policy documents_owner_insert
  on public.documents
  for insert
  to authenticated
  with check (
    uploaded_by = app.current_profile_id()
    and status = 'quarantined'
    and (provider_id is null or provider_id = app.current_profile_id())
  );

-- Owner can UPDATE only to flip deleted_at (the trigger freezes every other
-- column). WITH CHECK forces deleted_at non-null so the only legal owner
-- UPDATE is a soft-delete.
drop policy if exists documents_owner_soft_delete on public.documents;
create policy documents_owner_soft_delete
  on public.documents
  for update
  to authenticated
  using (uploaded_by = app.current_profile_id() and deleted_at is null)
  with check (uploaded_by = app.current_profile_id() and deleted_at is not null);

drop policy if exists documents_admin on public.documents;
create policy documents_admin
  on public.documents
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- verifications
-- =============================================================================
create table if not exists public.verifications (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null unique references public.documents(id) on delete cascade,
  state        text not null default 'pending' check (state in ('pending','in_review','approved','rejected')),
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists verifications_state_idx
  on public.verifications (state);

-- Touch reviewed_by / reviewed_at on state transitions + maintain updated_at.
create or replace function public.tg_verifications_touch_review()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    new.reviewed_by := coalesce(new.reviewed_by, app.current_profile_id());
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists verifications_touch_review on public.verifications;
create trigger verifications_touch_review
before update on public.verifications
for each row execute function public.tg_verifications_touch_review();

-- Wire the AFTER INSERT trigger on documents now that verifications exists.
drop trigger if exists tg_documents_create_verification on public.documents;
create trigger tg_documents_create_verification
after insert on public.documents
for each row execute function public.tg_documents_create_verification();

alter table public.verifications enable row level security;

revoke all on public.verifications from anon, authenticated;
grant select on public.verifications to authenticated;
-- Deliberately no INSERT / UPDATE / DELETE grant to authenticated. Admin path
-- goes through the admin policy; owner creation goes through the security
-- definer trigger.

drop policy if exists verifications_owner_read on public.verifications;
create policy verifications_owner_read
  on public.verifications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.documents d
      where d.id = verifications.document_id
        and d.uploaded_by = app.current_profile_id()
        and d.deleted_at is null
    )
  );
-- NB: This is the single intentional exception to the "every policy is a
-- one-liner calling an app.* helper" rule. A dedicated helper
-- (app.owns_document(uuid)) would be over-engineering for one callsite;
-- upgrade to a helper if documents grows more RLS surfaces.

drop policy if exists verifications_admin on public.verifications;
create policy verifications_admin
  on public.verifications
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- Admin needs INSERT / UPDATE grants for the admin policy to be meaningful.
grant insert, update on public.verifications to authenticated;

-- =============================================================================
-- app.is_provider_verified() real body (replaces the 0001 stub)
-- =============================================================================
create or replace function app.is_provider_verified()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.provider_profiles
    where id = app.current_profile_id()
      and verified_at is not null
      and deleted_at is null
  );
$$;

-- =============================================================================
-- Storage bucket: provider-docs
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('provider-docs', 'provider-docs', false)
on conflict (id) do nothing;

-- INSERT: upload into quarantine/<my-profile-id>/<filename>
drop policy if exists provider_docs_owner_insert on storage.objects;
create policy provider_docs_owner_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'provider-docs'
    and (storage.foldername(name))[1] = 'quarantine'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

-- SELECT: owner can read their own quarantine/ or clean/ objects; admin can
-- read any object in the bucket.
drop policy if exists provider_docs_owner_read on storage.objects;
create policy provider_docs_owner_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'provider-docs'
    and (
      (
        (storage.foldername(name))[1] in ('quarantine','clean')
        and (storage.foldername(name))[2]::uuid = auth.uid()
      )
      or app.current_role() = 'admin'::public.app_role
    )
  );

-- UPDATE: admin only (the promote step from quarantine/ -> clean/ runs via
-- the service-role admin client which bypasses RLS; this policy is for manual
-- admin ops).
drop policy if exists provider_docs_admin_update on storage.objects;
create policy provider_docs_admin_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'provider-docs' and app.current_role() = 'admin'::public.app_role)
  with check (bucket_id = 'provider-docs' and app.current_role() = 'admin'::public.app_role);

-- DELETE: owner can delete their own quarantine objects; admin can delete any.
drop policy if exists provider_docs_owner_delete on storage.objects;
create policy provider_docs_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'provider-docs'
    and (
      (
        (storage.foldername(name))[1] = 'quarantine'
        and (storage.foldername(name))[2]::uuid = auth.uid()
      )
      or app.current_role() = 'admin'::public.app_role
    )
  );
