-- 0012_provider_companies.sql
--
-- C3b: Provider companies and company memberships.
--   - provider_companies table (1:1 with profiles where role='provider_company')
--   - company_memberships table (links individual providers to companies)
--   - Real body for app.is_company_member() (replaces the 0001 stub)
--   - FK upgrade on documents.provider_company_id
--   - Storage policies for company document uploads
--   - Updated documents_owner_insert to allow company uploads

-- =============================================================================
-- provider_companies
-- =============================================================================
create table if not exists public.provider_companies (
  id                  uuid primary key references public.profiles(id) on delete cascade,
  company_name        text not null,
  company_number      text,
  registered_address  text,
  service_postcode    text,
  latitude            float8,
  longitude           float8,
  geocoded_at         timestamptz,
  description         text,
  website             text,
  phone               text,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists provider_companies_verified_idx
  on public.provider_companies (verified_at)
  where verified_at is not null and deleted_at is null;

drop trigger if exists provider_companies_set_updated_at on public.provider_companies;
create trigger provider_companies_set_updated_at
before update on public.provider_companies
for each row execute function app.tg_set_updated_at();

-- Guard trigger: verified_at is admin-only, undelete is admin-only. Mirrors
-- the tg_provider_profiles_guard_verification shape from 0004.
create or replace function public.tg_provider_companies_guard_verification()
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

drop trigger if exists tg_provider_companies_guard_verification on public.provider_companies;
create trigger tg_provider_companies_guard_verification
before update on public.provider_companies
for each row execute function public.tg_provider_companies_guard_verification();

alter table public.provider_companies enable row level security;

revoke all on public.provider_companies from anon, authenticated;
-- Narrow directory grant for anon: no phone, registered_address leakage.
grant select (id, company_name, company_number, service_postcode, description, website, verified_at)
  on public.provider_companies to anon;
-- Owners need full-column access for their edit screen.
grant select, insert, update, delete on public.provider_companies to authenticated;

-- Public directory: verified + non-deleted companies visible to everyone.
drop policy if exists provider_companies_public_read on public.provider_companies;
create policy provider_companies_public_read
  on public.provider_companies
  for select
  to anon, authenticated
  using (verified_at is not null and deleted_at is null);

-- Owner can read their own row (even if unverified).
drop policy if exists provider_companies_self_read on public.provider_companies;
create policy provider_companies_self_read
  on public.provider_companies
  for select
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null);

-- Admin can read all rows.
drop policy if exists provider_companies_admin_read on public.provider_companies;
create policy provider_companies_admin_read
  on public.provider_companies
  for select
  to authenticated
  using (app.current_role() = 'admin'::public.app_role);

-- Owner can insert their own row (verified_at forced null, deleted_at forced null).
drop policy if exists provider_companies_owner_insert on public.provider_companies;
create policy provider_companies_owner_insert
  on public.provider_companies
  for insert
  to authenticated
  with check (
    id = app.current_profile_id()
    and verified_at is null
    and deleted_at is null
  );

-- Owner can update their own row.
drop policy if exists provider_companies_self_update on public.provider_companies;
create policy provider_companies_self_update
  on public.provider_companies
  for update
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null)
  with check (id = app.current_profile_id());

-- Admin full access.
drop policy if exists provider_companies_admin_write on public.provider_companies;
create policy provider_companies_admin_write
  on public.provider_companies
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- company_memberships
-- =============================================================================
create table if not exists public.company_memberships (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.provider_companies(id) on delete cascade,
  provider_id  uuid not null references public.provider_profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','admin','member')),
  invited_by   uuid references public.profiles(id),
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  removed_at   timestamptz
);

-- Only one active membership per provider per company.
create unique index if not exists company_memberships_active_unique
  on public.company_memberships (company_id, provider_id)
  where removed_at is null;

create index if not exists company_memberships_company_idx
  on public.company_memberships (company_id)
  where removed_at is null;

create index if not exists company_memberships_provider_idx
  on public.company_memberships (provider_id)
  where removed_at is null;

alter table public.company_memberships enable row level security;

revoke all on public.company_memberships from anon, authenticated;
grant select, insert, update, delete on public.company_memberships to authenticated;

-- Members of the company can read all memberships for that company.
drop policy if exists company_memberships_company_read on public.company_memberships;
create policy company_memberships_company_read
  on public.company_memberships
  for select
  to authenticated
  using (
    app.is_company_member(company_id)
    and removed_at is null
  );

-- A provider can read their own memberships (including pending invitations).
drop policy if exists company_memberships_provider_read on public.company_memberships;
create policy company_memberships_provider_read
  on public.company_memberships
  for select
  to authenticated
  using (provider_id = app.current_profile_id());

-- Admin can read all.
drop policy if exists company_memberships_admin_read on public.company_memberships;
create policy company_memberships_admin_read
  on public.company_memberships
  for select
  to authenticated
  using (app.current_role() = 'admin'::public.app_role);

-- Company owner/admin can insert new memberships (invites).
-- The company owner is the profile whose id = company_id (1:1 with provider_companies).
drop policy if exists company_memberships_company_admin_insert on public.company_memberships;
create policy company_memberships_company_admin_insert
  on public.company_memberships
  for insert
  to authenticated
  with check (
    (
      -- The company owner (profile id = company_id)
      company_id = app.current_profile_id()
      or
      -- Or an existing admin/owner member
      exists (
        select 1
        from public.company_memberships cm
        where cm.company_id = company_memberships.company_id
          and cm.provider_id = app.current_profile_id()
          and cm.role in ('owner','admin')
          and cm.removed_at is null
          and cm.accepted_at is not null
      )
    )
    and removed_at is null
  );

-- Company owner/admin can update memberships (accept, remove, change role).
drop policy if exists company_memberships_company_admin_update on public.company_memberships;
create policy company_memberships_company_admin_update
  on public.company_memberships
  for update
  to authenticated
  using (
    company_id = app.current_profile_id()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = company_memberships.company_id
        and cm.provider_id = app.current_profile_id()
        and cm.role in ('owner','admin')
        and cm.removed_at is null
        and cm.accepted_at is not null
    )
  )
  with check (true);

-- A provider can update their own membership (to accept an invitation).
drop policy if exists company_memberships_self_update on public.company_memberships;
create policy company_memberships_self_update
  on public.company_memberships
  for update
  to authenticated
  using (provider_id = app.current_profile_id())
  with check (provider_id = app.current_profile_id());

-- Admin full access on memberships.
drop policy if exists company_memberships_admin_write on public.company_memberships;
create policy company_memberships_admin_write
  on public.company_memberships
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- app.is_company_member() real body (replaces 0001 stub)
-- =============================================================================
create or replace function app.is_company_member(company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.company_memberships
    where company_memberships.company_id = is_company_member.company_id
      and provider_id = app.current_profile_id()
      and removed_at is null
      and accepted_at is not null
  )
  or app.current_profile_id() = company_id;
$$;

-- =============================================================================
-- FK upgrade: documents.provider_company_id -> provider_companies.id
-- =============================================================================
alter table public.documents
  add constraint documents_provider_company_id_fk
  foreign key (provider_company_id) references public.provider_companies(id) on delete cascade;

create index if not exists documents_provider_company_idx
  on public.documents (provider_company_id)
  where deleted_at is null and provider_company_id is not null;

-- =============================================================================
-- Update documents_owner_insert to allow company document uploads.
-- A company owner (role=provider_company, id=company_id) can upload documents
-- attributed to their company. All other subject FKs must stay null.
-- =============================================================================
drop policy if exists documents_owner_insert on public.documents;
create policy documents_owner_insert
  on public.documents
  for insert
  to authenticated
  with check (
    uploaded_by = app.current_profile_id()
    and status = 'quarantined'
    and (
      -- Individual provider upload (existing path)
      (
        (provider_id is null or provider_id = app.current_profile_id())
        and provider_company_id is null
      )
      or
      -- Company upload: company owner uploads for their company
      (
        provider_id is null
        and provider_company_id = app.current_profile_id()
        and app.current_role() = 'provider_company'::public.app_role
      )
    )
    and receiver_id  is null
    and care_plan_id is null
    and visit_id     is null
    and message_id   is null
  );

-- Company members can also read documents attributed to their company.
drop policy if exists documents_company_read on public.documents;
create policy documents_company_read
  on public.documents
  for select
  to authenticated
  using (
    provider_company_id is not null
    and app.is_company_member(provider_company_id)
    and deleted_at is null
  );

-- =============================================================================
-- Storage policies for company uploads in the provider-docs bucket.
-- Company owners upload to quarantine/<company-profile-id>/... which is
-- the same pattern as individual providers (the company's profile id IS the
-- auth.uid() of the company account). The existing storage policies already
-- scope uploads to quarantine/<auth.uid()>/*, so no additional storage
-- policies are needed - the company owner's auth.uid() matches their
-- provider_companies.id.
-- =============================================================================
-- (No additional storage policies needed - existing policies in 0004 cover
-- the company owner path since their auth.uid() = provider_companies.id.)
