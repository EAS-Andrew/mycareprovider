-- pgTAP tests for public.provider_services RLS policies.
--
-- Covers the "draft not leaked" rule: anon only sees provider_services rows
-- for providers with provider_profiles.verified_at set. Also covers the
-- owner write boundary and the admin catch-all.
--
-- Runs under `supabase test db`: wrapped in a transaction, rolled back at
-- the end.

begin;

create extension if not exists pgtap;

select plan(11);

-- -----------------------------------------------------------------------------
-- Fixture users. handle_new_auth_user provisions profiles; provider_profiles
-- rows are seeded directly by the test session (postgres owner bypasses RLS
-- since the table is not forced).
--
-- sv1 = unverified provider
-- sv2 = verified provider
-- svd = admin
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sv1@t.test',
   '{"role":"provider","display_name":"SV1"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sv2@t.test',
   '{"role":"provider","display_name":"SV2"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'svd@t.test',
   '{"role":"admin","display_name":"SVD"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline, verified_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'Draft sv1',    null),
  ('00000000-0000-0000-0000-0000000000e2', 'Verified sv2', now());

-- Cache reference category ids in local session variables for readability.
-- (We reference them by SQL subquery in each statement below.)

-- =============================================================================
-- Owner sv1 (unverified): INSERT own, cannot INSERT for others, reads own
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000e1',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

insert into public.provider_services (provider_id, service_category_id)
  values (
    '00000000-0000-0000-0000-0000000000e1',
    (select id from public.service_categories where slug = 'personal-care')
  );

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'owner can INSERT + SELECT own provider_services row (unverified draft)'
);

-- Claiming someone else's provider_id is rejected by the owner_insert WITH CHECK.
select throws_ok(
  $$ insert into public.provider_services (provider_id, service_category_id)
     values (
       '00000000-0000-0000-0000-0000000000e2',
       (select id from public.service_categories where slug = 'companionship')
     ) $$,
  '42501',
  null,
  'owner cannot INSERT with provider_id other than self'
);

reset role;

-- =============================================================================
-- Other provider (sv2) cannot SELECT sv1's unverified rows
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000e2',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'other provider cannot SELECT sv1 unverified rows (not own + not verified)'
);

-- sv2 inserts own services (sv2 is verified so these become publicly visible).
insert into public.provider_services (provider_id, service_category_id)
  values (
    '00000000-0000-0000-0000-0000000000e2',
    (select id from public.service_categories where slug = 'dementia-care')
  );

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e2'),
  1,
  'sv2 owner can INSERT own provider_services row'
);

reset role;

-- =============================================================================
-- Anonymous browsing: sees verified sv2, not unverified sv1
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e2'),
  1,
  'anon CAN SELECT rows for a verified provider'
);

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'anon CANNOT SELECT rows for an unverified provider (draft gate)'
);

-- anon has no INSERT grant at all.
select throws_ok(
  $$ insert into public.provider_services (provider_id, service_category_id)
     values (
       '00000000-0000-0000-0000-0000000000e2',
       (select id from public.service_categories where slug = 'companionship')
     ) $$,
  '42501',
  null,
  'anon cannot INSERT into provider_services (no grant)'
);

reset role;

-- =============================================================================
-- Owner DELETE own row
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000e1',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

delete from public.provider_services
  where provider_id = '00000000-0000-0000-0000-0000000000e1'
    and service_category_id = (select id from public.service_categories where slug = 'personal-care');

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'owner can DELETE own provider_services row'
);

reset role;

-- =============================================================================
-- Admin catch-all: read everything, insert for another provider, delete it
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000ed',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

select ok(
  (select count(*) from public.provider_services) >= 1,
  'admin can SELECT all provider_services rows'
);

insert into public.provider_services (provider_id, service_category_id)
  values (
    '00000000-0000-0000-0000-0000000000e2',
    (select id from public.service_categories where slug = 'companionship')
  );

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e2'),
  2,
  'admin can INSERT provider_services on behalf of another provider'
);

delete from public.provider_services
  where provider_id = '00000000-0000-0000-0000-0000000000e2'
    and service_category_id = (select id from public.service_categories where slug = 'companionship');

select is(
  (select count(*)::int from public.provider_services
    where provider_id = '00000000-0000-0000-0000-0000000000e2'),
  1,
  'admin can DELETE provider_services rows'
);

reset role;

select * from finish();
rollback;
