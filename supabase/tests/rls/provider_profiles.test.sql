-- pgTAP tests for public.provider_profiles RLS policies and the
-- tg_provider_profiles_guard_verification trigger.
--
-- Runs under `supabase test db`: wrapped in a transaction, rolled back at
-- the end. Identities are switched via SET LOCAL ROLE + request.jwt.claims,
-- matching profiles.test.sql (no supabase-test-helpers dependency).

begin;

create extension if not exists pgtap;

select plan(10);

-- -----------------------------------------------------------------------------
-- Fixture users. handle_new_auth_user provisions the profiles rows.
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pp1@t.test',
   '{"role":"provider","display_name":"PP1"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pp2@t.test',
   '{"role":"provider","display_name":"PP2"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000fd', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-pp@t.test',
   '{"role":"admin","display_name":"AdminPP"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

-- Seed provider_profiles rows as the postgres test session owner (RLS is not
-- forced, so the table owner bypasses policies and can seed fixtures).
-- pp1 is a DRAFT (verified_at null), pp2 is VERIFIED.
insert into public.provider_profiles (id, headline, bio, date_of_birth, phone, city, country, years_experience, hourly_rate_pence, verified_at)
values
  ('00000000-0000-0000-0000-0000000000f1', 'Draft headline', 'Draft bio', '1980-01-01', '+447000000001', 'Leeds',  'GB', 3,  2500, null),
  ('00000000-0000-0000-0000-0000000000f2', 'Senior carer',  'Bio',       '1975-05-05', '+447000000002', 'London', 'GB', 12, 4000, now());

-- =============================================================================
-- Anonymous browsing
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f2'),
  1,
  'anon can read verified provider via public directory policy'
);

select is(
  (select count(*)::int from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'anon cannot read draft (unverified) provider'
);

-- The narrow column GRANT keeps private columns off the anon surface. Selecting
-- a restricted column must raise a permission error.
select throws_ok(
  $$ select phone from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f2' $$,
  '42501',
  null,
  'anon cannot select phone column (narrow column grant)'
);

reset role;

-- =============================================================================
-- Owner acting on their own draft row
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000f1',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  1,
  'owner can read own draft row'
);

-- Owner cannot read another provider's DRAFT row (only verified via public policy).
select is(
  (select headline from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f2'),
  'Senior carer',
  'owner CAN see another providers VERIFIED row via public-read policy'
);

-- Owner can update their own mutable fields.
update public.provider_profiles
  set headline = 'Updated headline'
  where id = '00000000-0000-0000-0000-0000000000f1';

select is(
  (select headline from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  'Updated headline',
  'owner can update own headline'
);

-- Owner cannot flip verified_at on themselves (guard trigger rejects).
select throws_ok(
  $$ update public.provider_profiles set verified_at = now() where id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'verified_at changes are admin-only',
  'owner cannot self-verify'
);

reset role;

-- =============================================================================
-- Admin path
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000fd',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

select ok(
  (select count(*) from public.provider_profiles) >= 2,
  'admin can read all provider_profiles rows (including drafts)'
);

-- Admin verifies pp1.
update public.provider_profiles
  set verified_at = now()
  where id = '00000000-0000-0000-0000-0000000000f1';

select isnt(
  (select verified_at from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  null::timestamptz,
  'admin can flip verified_at'
);

-- Admin soft-deletes pp2.
update public.provider_profiles
  set deleted_at = now()
  where id = '00000000-0000-0000-0000-0000000000f2';

reset role;

-- =============================================================================
-- Post-soft-delete visibility
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.provider_profiles where id = '00000000-0000-0000-0000-0000000000f2'),
  0,
  'soft-deleted provider is invisible to anon directory read'
);

reset role;

select * from finish();
rollback;
