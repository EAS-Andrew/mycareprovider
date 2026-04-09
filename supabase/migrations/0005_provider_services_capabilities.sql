-- 0005_provider_services_capabilities.sql
--
-- C6a anchor. Reference data for services/capabilities/certifications plus
-- the three provider linking tables that hang individual provider profiles
-- off the reference taxonomy.
--
-- DESIGN NOTES
-- ------------
-- 1. Pure reference tables (service_categories, capabilities, certifications)
--    have RLS enabled so default is deny, with a world-read policy and an
--    admin-write policy. No deleted_at - reference tables are not soft-deleted
--    per the PID; admins hard-remove obsolete rows. The seed is embedded in
--    the migration with ON CONFLICT so hosted environments get baseline rows
--    without a separate seed run.
--
-- 2. The linking tables (provider_services, provider_capabilities,
--    provider_certifications) are provider-owned. The "public directory"
--    SELECT policy on each one uses a narrow EXISTS against provider_profiles
--    to gate on verified_at. This is the one documented exception to the
--    "every policy is a one-liner calling an app.* helper" rule - a dedicated
--    helper would need to take provider_id as an argument and would not be
--    any clearer than the inline EXISTS. Mirrors the documents.verifications
--    exception called out in 0004.
--
-- 3. provider_services and provider_capabilities are composite-PK link tables
--    with no edit path: changes are delete+insert. No UPDATE policy for
--    owners; UPDATE is admin-only via the catch-all admin policy.
--
-- 4. provider_certifications carries a surrogate key and is soft-deleted,
--    because a provider may legitimately hold the same certification type
--    twice (an expired historical record plus a current one). A partial
--    unique index enforces "at most one active copy per type" and a BEFORE
--    DELETE guard trigger blocks hard-deletes on the non-admin path so
--    callers must UPDATE deleted_at instead. Because PostgreSQL RLS silently
--    matches zero rows when no DELETE policy exists (which would prevent the
--    trigger from firing at all), there IS an owner DELETE policy - its sole
--    job is to let the row reach the trigger so the trigger can raise.
--
-- 5. anon sees a narrowed column set on provider_certifications (no
--    `reference`, no `document_id`) so the public directory does not leak
--    issuing-body IDs or document linkage. authenticated keeps full-column
--    access so the owner's edit screen works - column grants are role-wide,
--    not per-policy, same boundary trade-off as 0004's provider_profiles.
--
-- 6. The verified-gate EXISTS subqueries filter on pp.verified_at but
--    deliberately do NOT reference pp.deleted_at directly: 0004's narrow anon
--    column grant on provider_profiles omits deleted_at, so referencing it
--    from a policy evaluated as anon would raise "permission denied for
--    column deleted_at" before RLS even runs. The deleted_at filter is still
--    enforced, just transitively via provider_profiles' own RLS policies
--    (public_read requires verified_at is not null AND deleted_at is null),
--    which apply when this subquery is planned against provider_profiles.
--
-- 7. Linking tables do NOT use FORCE ROW LEVEL SECURITY, matching 0004, so
--    future security-definer helpers can still maintain rows if needed.

-- =============================================================================
-- service_categories (pure reference)
-- =============================================================================
create table if not exists public.service_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.service_categories enable row level security;

revoke all on public.service_categories from anon, authenticated;
grant select (id, slug, name, description, sort_order, created_at)
  on public.service_categories to anon;
grant select, insert, update, delete on public.service_categories to authenticated;

drop policy if exists service_categories_public_read on public.service_categories;
create policy service_categories_public_read
  on public.service_categories
  for select
  to anon, authenticated
  using (true);

drop policy if exists service_categories_admin_write on public.service_categories;
create policy service_categories_admin_write
  on public.service_categories
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- capabilities (pure reference, optionally scoped to a service_category)
-- =============================================================================
create table if not exists public.capabilities (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  description         text,
  sort_order          int  not null default 0,
  service_category_id uuid references public.service_categories(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists capabilities_service_category_idx
  on public.capabilities (service_category_id)
  where service_category_id is not null;

alter table public.capabilities enable row level security;

revoke all on public.capabilities from anon, authenticated;
grant select (id, slug, name, description, sort_order, service_category_id, created_at)
  on public.capabilities to anon;
grant select, insert, update, delete on public.capabilities to authenticated;

drop policy if exists capabilities_public_read on public.capabilities;
create policy capabilities_public_read
  on public.capabilities
  for select
  to anon, authenticated
  using (true);

drop policy if exists capabilities_admin_write on public.capabilities;
create policy capabilities_admin_write
  on public.capabilities
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- certifications (pure reference)
-- =============================================================================
create table if not exists public.certifications (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  sort_order  int  not null default 0,
  expires     boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.certifications enable row level security;

revoke all on public.certifications from anon, authenticated;
grant select (id, slug, name, description, sort_order, expires, created_at)
  on public.certifications to anon;
grant select, insert, update, delete on public.certifications to authenticated;

drop policy if exists certifications_public_read on public.certifications;
create policy certifications_public_read
  on public.certifications
  for select
  to anon, authenticated
  using (true);

drop policy if exists certifications_admin_write on public.certifications;
create policy certifications_admin_write
  on public.certifications
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- Seed data (idempotent - safe to re-run across environments)
--
-- Choice of rows is a deliberately conservative UK care-sector starter set.
-- Real taxonomy curation is a C5 admin operation; the point of the seed is
-- to give dev/staging enough rows to exercise the UI without needing a
-- separate seed run.
-- =============================================================================
insert into public.service_categories (slug, name, description, sort_order) values
  ('personal-care',               'Personal care',               'Bathing, dressing, toileting, and continence support.',        10),
  ('companionship',               'Companionship',               'Social visits, conversation, and accompaniment.',              20),
  ('domestic-support',            'Domestic support',            'Light housekeeping, laundry, and meal preparation.',           30),
  ('medication-support',          'Medication support',          'Prompting or administering prescribed medication.',            40),
  ('dementia-care',               'Dementia care',               'Specialist support for people living with dementia.',          50),
  ('end-of-life-care',            'End-of-life care',            'Palliative and end-of-life support at home.',                  60),
  ('learning-disability-support', 'Learning disability support', 'Support for adults with learning disabilities.',               70),
  ('live-in-care',                'Live-in care',                '24-hour live-in care in the client''s home.',                  80)
on conflict (slug) do nothing;

insert into public.capabilities (slug, name, description, sort_order, service_category_id) values
  ('manual-handling',           'Manual handling',           'Trained in safe manual handling techniques.',                    10, (select id from public.service_categories where slug = 'personal-care')),
  ('hoist-transfer',            'Hoist transfer',            'Trained in mechanical hoist transfers.',                         20, (select id from public.service_categories where slug = 'personal-care')),
  ('catheter-care',             'Catheter care',             'Trained in catheter management and hygiene.',                    30, (select id from public.service_categories where slug = 'personal-care')),
  ('stoma-care',                'Stoma care',                'Trained in stoma management and hygiene.',                       40, (select id from public.service_categories where slug = 'personal-care')),
  ('peg-feeding',               'PEG feeding',               'Trained in percutaneous endoscopic gastrostomy feeding.',        50, (select id from public.service_categories where slug = 'personal-care')),
  ('dementia-care-trained',     'Dementia care trained',     'Completed recognised dementia care training.',                   60, (select id from public.service_categories where slug = 'dementia-care')),
  ('end-of-life-trained',       'End-of-life trained',       'Completed recognised end-of-life/palliative care training.',     70, (select id from public.service_categories where slug = 'end-of-life-care')),
  ('mental-health-first-aid',   'Mental health first aid',   'Certified in mental health first aid.',                          80, null),
  ('medication-administration', 'Medication administration', 'Trained to administer prescribed medication.',                   90, (select id from public.service_categories where slug = 'medication-support'))
on conflict (slug) do nothing;

insert into public.certifications (slug, name, description, sort_order, expires) values
  ('dbs-enhanced',                   'Enhanced DBS check',                'Enhanced Disclosure and Barring Service check.',       10, true),
  ('first-aid-at-work',              'First Aid at Work',                 'Three-day First Aid at Work qualification.',           20, true),
  ('emergency-first-aid',            'Emergency First Aid at Work',       'One-day Emergency First Aid at Work qualification.',   30, true),
  ('moving-and-handling',            'Moving and Handling',               'Moving and handling of people training.',              40, true),
  ('medication-administration-qcf',  'Medication Administration (QCF)',   'QCF-accredited medication administration training.',   50, true),
  ('care-certificate',               'Care Certificate',                  'The Care Certificate (15 standards).',                 60, false),
  ('nvq-level-2-health-social-care', 'NVQ Level 2 Health & Social Care',  'NVQ Level 2 in Health and Social Care.',               70, false),
  ('nvq-level-3-health-social-care', 'NVQ Level 3 Health & Social Care',  'NVQ Level 3 in Health and Social Care.',               80, false)
on conflict (slug) do nothing;

-- =============================================================================
-- provider_services (composite-PK linking table)
-- =============================================================================
create table if not exists public.provider_services (
  provider_id         uuid not null references public.provider_profiles(id) on delete cascade,
  service_category_id uuid not null references public.service_categories(id) on delete restrict,
  created_at          timestamptz not null default now(),
  primary key (provider_id, service_category_id)
);

create index if not exists provider_services_category_idx
  on public.provider_services (service_category_id);

alter table public.provider_services enable row level security;

revoke all on public.provider_services from anon, authenticated;
grant select (provider_id, service_category_id, created_at)
  on public.provider_services to anon;
grant select, insert, update, delete on public.provider_services to authenticated;

drop policy if exists provider_services_public_read on public.provider_services;
create policy provider_services_public_read
  on public.provider_services
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.provider_profiles pp
      where pp.id = provider_services.provider_id
        and pp.verified_at is not null
    )
  );

drop policy if exists provider_services_owner_read on public.provider_services;
create policy provider_services_owner_read
  on public.provider_services
  for select
  to authenticated
  using (provider_id = app.current_profile_id());

drop policy if exists provider_services_owner_insert on public.provider_services;
create policy provider_services_owner_insert
  on public.provider_services
  for insert
  to authenticated
  with check (provider_id = app.current_profile_id());

drop policy if exists provider_services_owner_delete on public.provider_services;
create policy provider_services_owner_delete
  on public.provider_services
  for delete
  to authenticated
  using (provider_id = app.current_profile_id());

drop policy if exists provider_services_admin on public.provider_services;
create policy provider_services_admin
  on public.provider_services
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- provider_capabilities (composite-PK linking table)
-- =============================================================================
create table if not exists public.provider_capabilities (
  provider_id   uuid not null references public.provider_profiles(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete restrict,
  created_at    timestamptz not null default now(),
  primary key (provider_id, capability_id)
);

create index if not exists provider_capabilities_capability_idx
  on public.provider_capabilities (capability_id);

alter table public.provider_capabilities enable row level security;

revoke all on public.provider_capabilities from anon, authenticated;
grant select (provider_id, capability_id, created_at)
  on public.provider_capabilities to anon;
grant select, insert, update, delete on public.provider_capabilities to authenticated;

drop policy if exists provider_capabilities_public_read on public.provider_capabilities;
create policy provider_capabilities_public_read
  on public.provider_capabilities
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.provider_profiles pp
      where pp.id = provider_capabilities.provider_id
        and pp.verified_at is not null
    )
  );

drop policy if exists provider_capabilities_owner_read on public.provider_capabilities;
create policy provider_capabilities_owner_read
  on public.provider_capabilities
  for select
  to authenticated
  using (provider_id = app.current_profile_id());

drop policy if exists provider_capabilities_owner_insert on public.provider_capabilities;
create policy provider_capabilities_owner_insert
  on public.provider_capabilities
  for insert
  to authenticated
  with check (provider_id = app.current_profile_id());

drop policy if exists provider_capabilities_owner_delete on public.provider_capabilities;
create policy provider_capabilities_owner_delete
  on public.provider_capabilities
  for delete
  to authenticated
  using (provider_id = app.current_profile_id());

drop policy if exists provider_capabilities_admin on public.provider_capabilities;
create policy provider_capabilities_admin
  on public.provider_capabilities
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- provider_certifications (surrogate key, soft-deleted)
-- =============================================================================
create table if not exists public.provider_certifications (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.provider_profiles(id) on delete cascade,
  certification_id uuid not null references public.certifications(id) on delete restrict,
  document_id      uuid references public.documents(id) on delete set null,
  reference        text,
  issued_on        date,
  expires_on       date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- At most one active (non-soft-deleted) row per (provider, certification type).
create unique index if not exists provider_certifications_active_unique
  on public.provider_certifications (provider_id, certification_id)
  where deleted_at is null;

create index if not exists provider_certifications_provider_idx
  on public.provider_certifications (provider_id)
  where deleted_at is null;

drop trigger if exists provider_certifications_set_updated_at on public.provider_certifications;
create trigger provider_certifications_set_updated_at
before update on public.provider_certifications
for each row execute function app.tg_set_updated_at();

-- Guard trigger: block hard-delete on the non-admin path so soft-delete is
-- the only option for providers. Admin callers bypass for operational cleanup.
create or replace function public.tg_provider_certifications_block_delete()
returns trigger
language plpgsql
as $$
begin
  if app.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'provider_certifications are soft-deleted; set deleted_at instead'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists tg_provider_certifications_block_delete on public.provider_certifications;
create trigger tg_provider_certifications_block_delete
before delete on public.provider_certifications
for each row execute function public.tg_provider_certifications_block_delete();

alter table public.provider_certifications enable row level security;

revoke all on public.provider_certifications from anon, authenticated;
-- Narrowed anon grant: the public directory must not leak reference numbers
-- or document linkage. authenticated keeps full-column access so owner
-- edit screens work; row-level filtering is left to the policies below.
grant select (id, provider_id, certification_id, issued_on, expires_on, created_at)
  on public.provider_certifications to anon;
grant select, insert, update, delete on public.provider_certifications to authenticated;

drop policy if exists provider_certifications_public_read on public.provider_certifications;
create policy provider_certifications_public_read
  on public.provider_certifications
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.provider_profiles pp
      where pp.id = provider_certifications.provider_id
        and pp.verified_at is not null
    )
  );

drop policy if exists provider_certifications_owner_read on public.provider_certifications;
create policy provider_certifications_owner_read
  on public.provider_certifications
  for select
  to authenticated
  using (provider_id = app.current_profile_id());

drop policy if exists provider_certifications_owner_insert on public.provider_certifications;
create policy provider_certifications_owner_insert
  on public.provider_certifications
  for insert
  to authenticated
  with check (
    provider_id = app.current_profile_id()
    and deleted_at is null
  );

drop policy if exists provider_certifications_owner_update on public.provider_certifications;
create policy provider_certifications_owner_update
  on public.provider_certifications
  for update
  to authenticated
  using (provider_id = app.current_profile_id())
  with check (provider_id = app.current_profile_id());

-- Deliberately present so the guard trigger can fire on the owner path
-- (without a matching DELETE policy, RLS silently rejects and the trigger
-- never runs). The trigger is what actually enforces "no hard delete".
drop policy if exists provider_certifications_owner_delete on public.provider_certifications;
create policy provider_certifications_owner_delete
  on public.provider_certifications
  for delete
  to authenticated
  using (provider_id = app.current_profile_id());

drop policy if exists provider_certifications_admin on public.provider_certifications;
create policy provider_certifications_admin
  on public.provider_certifications
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);
