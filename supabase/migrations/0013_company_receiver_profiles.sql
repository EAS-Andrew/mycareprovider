-- 0013_company_receiver_profiles.sql
--
-- C6b: Company & receiver needs profiles.
--   - company_services + company_capabilities (composite-PK linking tables,
--     mirroring provider_services/provider_capabilities from 0005)
--   - receiver_profiles (care needs, preferences, location)
--   - RLS policies on all new tables
--   - mobility_level enum
--
-- DESIGN NOTES
-- ------------
-- 1. company_services and company_capabilities follow the same composite-PK
--    delete-and-reinsert pattern as provider_services/provider_capabilities.
--    Public read is gated on the company's verified_at (matching the provider
--    pattern from 0005 note 2), with an inline EXISTS rather than a helper.
--
-- 2. receiver_profiles is private by design. Unlike provider profiles, it is
--    NOT publicly readable. Access is limited to:
--    - The receiver themselves (self-read/update)
--    - Care circle members (via app.is_care_circle_member)
--    - Admins (full access)
--    Anon has zero access.
--
-- 3. The mobility_level enum is a short, stable list that guides matching
--    and does not need admin curation (unlike service_categories).

-- =============================================================================
-- mobility_level enum
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'mobility_level') then
    create type public.mobility_level as enum (
      'fully_mobile',
      'limited_mobility',
      'wheelchair_user',
      'bed_bound'
    );
  end if;
end
$$;

-- =============================================================================
-- company_services (composite-PK linking table)
-- =============================================================================
create table if not exists public.company_services (
  company_id          uuid not null references public.provider_companies(id) on delete cascade,
  service_category_id uuid not null references public.service_categories(id) on delete restrict,
  created_at          timestamptz not null default now(),
  primary key (company_id, service_category_id)
);

create index if not exists company_services_category_idx
  on public.company_services (service_category_id);

alter table public.company_services enable row level security;

revoke all on public.company_services from anon, authenticated;
grant select (company_id, service_category_id, created_at)
  on public.company_services to anon;
grant select, insert, update, delete on public.company_services to authenticated;

-- Public read: verified companies only (mirrors provider_services pattern).
drop policy if exists company_services_public_read on public.company_services;
create policy company_services_public_read
  on public.company_services
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.provider_companies pc
      where pc.id = company_services.company_id
        and pc.verified_at is not null
    )
  );

-- Owner can read their own (even if unverified).
drop policy if exists company_services_owner_read on public.company_services;
create policy company_services_owner_read
  on public.company_services
  for select
  to authenticated
  using (company_id = app.current_profile_id());

-- Owner can insert.
drop policy if exists company_services_owner_insert on public.company_services;
create policy company_services_owner_insert
  on public.company_services
  for insert
  to authenticated
  with check (company_id = app.current_profile_id());

-- Owner can delete (delete-and-reinsert pattern, no UPDATE needed for owners).
drop policy if exists company_services_owner_delete on public.company_services;
create policy company_services_owner_delete
  on public.company_services
  for delete
  to authenticated
  using (company_id = app.current_profile_id());

-- Admin full access.
drop policy if exists company_services_admin on public.company_services;
create policy company_services_admin
  on public.company_services
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- company_capabilities (composite-PK linking table)
-- =============================================================================
create table if not exists public.company_capabilities (
  company_id    uuid not null references public.provider_companies(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete restrict,
  created_at    timestamptz not null default now(),
  primary key (company_id, capability_id)
);

create index if not exists company_capabilities_capability_idx
  on public.company_capabilities (capability_id);

alter table public.company_capabilities enable row level security;

revoke all on public.company_capabilities from anon, authenticated;
grant select (company_id, capability_id, created_at)
  on public.company_capabilities to anon;
grant select, insert, update, delete on public.company_capabilities to authenticated;

-- Public read: verified companies only.
drop policy if exists company_capabilities_public_read on public.company_capabilities;
create policy company_capabilities_public_read
  on public.company_capabilities
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.provider_companies pc
      where pc.id = company_capabilities.company_id
        and pc.verified_at is not null
    )
  );

-- Owner can read their own.
drop policy if exists company_capabilities_owner_read on public.company_capabilities;
create policy company_capabilities_owner_read
  on public.company_capabilities
  for select
  to authenticated
  using (company_id = app.current_profile_id());

-- Owner can insert.
drop policy if exists company_capabilities_owner_insert on public.company_capabilities;
create policy company_capabilities_owner_insert
  on public.company_capabilities
  for insert
  to authenticated
  with check (company_id = app.current_profile_id());

-- Owner can delete.
drop policy if exists company_capabilities_owner_delete on public.company_capabilities;
create policy company_capabilities_owner_delete
  on public.company_capabilities
  for delete
  to authenticated
  using (company_id = app.current_profile_id());

-- Admin full access.
drop policy if exists company_capabilities_admin on public.company_capabilities;
create policy company_capabilities_admin
  on public.company_capabilities
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- receiver_profiles
-- =============================================================================
create table if not exists public.receiver_profiles (
  id                        uuid primary key references public.profiles(id) on delete cascade,
  care_needs_summary        text,
  preferred_gender          text,
  preferred_schedule        text,
  mobility_level            public.mobility_level,
  communication_needs       text,
  dietary_requirements      text,
  medical_conditions_summary text,
  postcode                  text,
  latitude                  float8,
  longitude                 float8,
  geocoded_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz
);

create index if not exists receiver_profiles_postcode_idx
  on public.receiver_profiles (postcode)
  where deleted_at is null and postcode is not null;

drop trigger if exists receiver_profiles_set_updated_at on public.receiver_profiles;
create trigger receiver_profiles_set_updated_at
before update on public.receiver_profiles
for each row execute function app.tg_set_updated_at();

alter table public.receiver_profiles enable row level security;

-- No grants to anon at all - receiver profiles are private.
revoke all on public.receiver_profiles from anon, authenticated;
grant select, insert, update, delete on public.receiver_profiles to authenticated;

-- Self-read: the receiver can read their own profile.
drop policy if exists receiver_profiles_self_read on public.receiver_profiles;
create policy receiver_profiles_self_read
  on public.receiver_profiles
  for select
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null);

-- Care circle member read: family members in the receiver's circle can read.
drop policy if exists receiver_profiles_circle_read on public.receiver_profiles;
create policy receiver_profiles_circle_read
  on public.receiver_profiles
  for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.care_circles cc
      where cc.receiver_id = receiver_profiles.id
        and cc.deleted_at is null
        and app.is_care_circle_member(cc.id)
    )
  );

-- Self-insert: receiver can create their own profile.
drop policy if exists receiver_profiles_self_insert on public.receiver_profiles;
create policy receiver_profiles_self_insert
  on public.receiver_profiles
  for insert
  to authenticated
  with check (
    id = app.current_profile_id()
    and deleted_at is null
  );

-- Self-update: receiver can update their own profile.
drop policy if exists receiver_profiles_self_update on public.receiver_profiles;
create policy receiver_profiles_self_update
  on public.receiver_profiles
  for update
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null)
  with check (id = app.current_profile_id());

-- Admin full access.
drop policy if exists receiver_profiles_admin on public.receiver_profiles;
create policy receiver_profiles_admin
  on public.receiver_profiles
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);
