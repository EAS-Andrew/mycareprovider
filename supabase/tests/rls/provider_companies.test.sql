-- pgTAP tests for public.provider_companies and public.company_memberships
-- RLS policies and guard triggers.
--
-- Runs under `supabase test db`: wrapped in a transaction, rolled back at
-- the end. Identities are switched via SET LOCAL ROLE + request.jwt.claims.

begin;

create extension if not exists pgtap;

select plan(18);

-- -----------------------------------------------------------------------------
-- Fixture users. handle_new_auth_user provisions the profiles rows.
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  -- Company owner
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'company1@t.test',
   '{"role":"provider_company","display_name":"Company One"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  -- Individual provider (will be invited as member)
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'provider-member@t.test',
   '{"role":"provider","display_name":"ProvMember"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  -- Another company (should not see company1's data)
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'company2@t.test',
   '{"role":"provider_company","display_name":"Company Two"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  -- Admin
  ('00000000-0000-0000-0000-000000000cad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-co@t.test',
   '{"role":"admin","display_name":"AdminCo"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

-- Seed provider_profiles for the individual provider.
insert into public.provider_profiles (id, headline, bio, city, country)
values ('00000000-0000-0000-0000-000000000c02', 'Member headline', 'Member bio', 'Leeds', 'GB');

-- Seed provider_companies as the postgres session owner (bypasses RLS).
insert into public.provider_companies (id, company_name, company_number, phone, verified_at)
values
  ('00000000-0000-0000-0000-000000000c01', 'Company One Ltd', '12345678', '+441234567890', null),
  ('00000000-0000-0000-0000-000000000c03', 'Company Two Ltd', '87654321', '+441234567891', now());

-- Seed a membership: provider c02 is a member of company c01, accepted.
insert into public.company_memberships (id, company_id, provider_id, role, invited_by, accepted_at)
values ('00000000-0000-0000-0000-00000000cm01', '00000000-0000-0000-0000-000000000c01',
        '00000000-0000-0000-0000-000000000c02', 'member',
        '00000000-0000-0000-0000-000000000c01', now());

-- =============================================================================
-- Anonymous browsing
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.provider_companies where id = '00000000-0000-0000-0000-000000000c03'),
  1,
  'anon can read verified company via public directory policy'
);

select is(
  (select count(*)::int from public.provider_companies where id = '00000000-0000-0000-0000-000000000c01'),
  0,
  'anon cannot read unverified company'
);

-- Narrow column grant keeps phone off the anon surface.
select throws_ok(
  $$ select phone from public.provider_companies where id = '00000000-0000-0000-0000-000000000c03' $$,
  '42501',
  null,
  'anon cannot select phone column (narrow column grant)'
);

reset role;

-- =============================================================================
-- Company owner acting on own row
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000c01',
    'role',     'authenticated',
    'app_role', 'provider_company'
  )::text,
  true
);

select is(
  (select count(*)::int from public.provider_companies where id = '00000000-0000-0000-0000-000000000c01'),
  1,
  'company owner can read own unverified row'
);

-- Owner can update own mutable fields.
update public.provider_companies
  set description = 'Updated description'
  where id = '00000000-0000-0000-0000-000000000c01';

select is(
  (select description from public.provider_companies where id = '00000000-0000-0000-0000-000000000c01'),
  'Updated description',
  'company owner can update own description'
);

-- Owner cannot flip verified_at on themselves (guard trigger rejects).
select throws_ok(
  $$ update public.provider_companies set verified_at = now() where id = '00000000-0000-0000-0000-000000000c01' $$,
  '42501',
  'verified_at changes are admin-only',
  'company owner cannot self-verify'
);

-- Owner cannot see another company's unverified row.
-- (company c03 IS verified, so it's visible via public read)
select is(
  (select company_name from public.provider_companies where id = '00000000-0000-0000-0000-000000000c03'),
  'Company Two Ltd',
  'company owner CAN see another companys VERIFIED row via public-read policy'
);

reset role;

-- =============================================================================
-- Company memberships
-- =============================================================================

-- Company owner can see memberships for their company.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000c01',
    'role',     'authenticated',
    'app_role', 'provider_company'
  )::text,
  true
);

select is(
  (select count(*)::int from public.company_memberships where company_id = '00000000-0000-0000-0000-000000000c01'),
  1,
  'company owner can read memberships for own company'
);

reset role;

-- The member provider can see their own membership.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000c02',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.company_memberships where provider_id = '00000000-0000-0000-0000-000000000c02'),
  1,
  'provider member can read own membership'
);

reset role;

-- Another company cannot see company1's memberships.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000c03',
    'role',     'authenticated',
    'app_role', 'provider_company'
  )::text,
  true
);

select is(
  (select count(*)::int from public.company_memberships where company_id = '00000000-0000-0000-0000-000000000c01'),
  0,
  'other company cannot see company1 memberships'
);

reset role;

-- =============================================================================
-- app.is_company_member() helper
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000c02',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select ok(
  app.is_company_member('00000000-0000-0000-0000-000000000c01'),
  'accepted member is recognized by app.is_company_member'
);

select ok(
  not app.is_company_member('00000000-0000-0000-0000-000000000c03'),
  'non-member is not recognized by app.is_company_member'
);

reset role;

-- Company owner is always a company member (profile id = company id).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000c01',
    'role',     'authenticated',
    'app_role', 'provider_company'
  )::text,
  true
);

select ok(
  app.is_company_member('00000000-0000-0000-0000-000000000c01'),
  'company owner is recognized as company member via profile id match'
);

reset role;

-- =============================================================================
-- Admin path
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000cad',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

select ok(
  (select count(*) from public.provider_companies) >= 2,
  'admin can read all provider_companies rows (including unverified)'
);

-- Admin verifies company c01.
update public.provider_companies
  set verified_at = now()
  where id = '00000000-0000-0000-0000-000000000c01';

select isnt(
  (select verified_at from public.provider_companies where id = '00000000-0000-0000-0000-000000000c01'),
  null::timestamptz,
  'admin can flip verified_at on a company'
);

-- Admin soft-deletes company c03.
update public.provider_companies
  set deleted_at = now()
  where id = '00000000-0000-0000-0000-000000000c03';

reset role;

-- =============================================================================
-- Post-soft-delete visibility
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.provider_companies where id = '00000000-0000-0000-0000-000000000c03'),
  0,
  'soft-deleted company is invisible to anon directory read'
);

reset role;

select * from finish();
rollback;
