-- pgTAP tests for the C7a provider search surface:
--   - new column grants on provider_profiles (latitude, service_postcode)
--   - app.search_providers() RPC filters and limit cap
--
-- Runs under `supabase test db`: wrapped in a transaction, rolled back at
-- the end. Identities are switched via SET LOCAL ROLE + request.jwt.claims,
-- matching the other RLS test files in this directory.

begin;

create extension if not exists pgtap;

select plan(15);

-- Clear the seed.sql demo provider rows so this test only sees its own
-- fixtures. Rollback at the end of the file restores the seed automatically.
-- (seed.sql was extended with verified demo providers after this test file
-- was authored; rather than teach every count assertion about the two seed
-- rows, we wipe the slate once at the top.)
delete from public.provider_capabilities;
delete from public.provider_services;
delete from public.provider_profiles;

-- -----------------------------------------------------------------------------
-- Fixture users. handle_new_auth_user provisions the profiles rows.
--   s1 = verified provider in London (anchor for radius + service + capability)
--   s2 = verified provider in Edinburgh with "dementia" in bio
--   s3 = DRAFT provider in London (unverified)
--   s4 = verified provider in London but soft-deleted
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000c7a01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ps1@t.test',
   '{"role":"provider","display_name":"PS1"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000c7a02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ps2@t.test',
   '{"role":"provider","display_name":"PS2"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000c7a03', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ps3@t.test',
   '{"role":"provider","display_name":"PS3"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000c7a04', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ps4@t.test',
   '{"role":"provider","display_name":"PS4"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

-- Seed provider_profiles rows as the postgres test session (RLS not forced,
-- the table owner bypasses policies). Coordinates:
--   London    ~ (51.5074, -0.1278)
--   Edinburgh ~ (55.9533, -3.1883)  (>500 km from London)
insert into public.provider_profiles (
  id, headline, bio, phone, city, country, years_experience, hourly_rate_pence,
  service_postcode, latitude, longitude, service_radius_km, verified_at, deleted_at
) values
  ('00000000-0000-0000-0000-0000000c7a01', 'London carer', 'General personal care experience',
   '+447000000001', 'London',    'GB', 10, 3000, 'SW1A 1AA', 51.5074, -0.1278, 25, now(),  null),
  ('00000000-0000-0000-0000-0000000c7a02', 'Edinburgh specialist', 'Experienced in dementia care and palliative support',
   '+447000000002', 'Edinburgh', 'GB', 15, 3500, 'EH1 1YZ',  55.9533, -3.1883, 25, now(),  null),
  ('00000000-0000-0000-0000-0000000c7a03', 'Draft carer', 'Just signed up',
   '+447000000003', 'London',    'GB',  2, 2000, 'E1 6AN',   51.5140, -0.0720, 10, null,   null),
  ('00000000-0000-0000-0000-0000000c7a04', 'Deleted carer', 'Was active once',
   '+447000000004', 'London',    'GB',  5, 2500, 'N1 9GU',   51.5330, -0.1020, 15, now(),  now());

-- Link s1 to personal-care service + manual-handling capability so the slug
-- filters have something to match.
insert into public.provider_services (provider_id, service_category_id)
values (
  '00000000-0000-0000-0000-0000000c7a01',
  (select id from public.service_categories where slug = 'personal-care')
);

insert into public.provider_capabilities (provider_id, capability_id)
values (
  '00000000-0000-0000-0000-0000000c7a01',
  (select id from public.capabilities where slug = 'manual-handling')
);

-- =============================================================================
-- Anonymous: baseline search (all nulls) should see only the two non-deleted
-- verified providers.
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from app.search_providers(null, null, null, null, null, null, 50, 0)),
  2,
  'anon search with no filters returns the 2 verified, non-deleted providers'
);

-- The public.search_providers wrapper is the PostgREST-reachable entry point.
-- Anon must be able to call it and it must return the same rowset as the
-- underlying app.search_providers function.
select is(
  (select count(*)::int from public.search_providers(null, null, null, null, null, null, 50, 0)),
  2,
  'anon can call public.search_providers wrapper (PostgREST surface) and gets the same 2 rows'
);

select is(
  (select count(*)::int from app.search_providers(null, null, null, null, null, null, 50, 0)
    where id = '00000000-0000-0000-0000-0000000c7a03'),
  0,
  'draft (unverified) provider does not appear in search results'
);

select is(
  (select count(*)::int from app.search_providers(null, null, null, null, null, null, 50, 0)
    where id = '00000000-0000-0000-0000-0000000c7a04'),
  0,
  'soft-deleted verified provider does not appear in search results'
);

-- Trigram-accelerated ILIKE on bio.
select is(
  (select array_agg(id order by id)
     from app.search_providers('dementia', null, null, null, null, null, 50, 0)),
  array['00000000-0000-0000-0000-0000000c7a02'::uuid],
  'query=dementia matches only the Edinburgh provider whose bio contains it'
);

-- Radius search: 50 km around London should pick up s1 (~0 km) but not
-- s2 (Edinburgh, >500 km away).
select is(
  (select array_agg(id order by id)
     from app.search_providers(null, 51.5074, -0.1278, 50, null, null, 50, 0)),
  array['00000000-0000-0000-0000-0000000c7a01'::uuid],
  '50 km radius around London returns only the London provider'
);

-- service_slug filter narrows to the linked provider.
select is(
  (select array_agg(id order by id)
     from app.search_providers(null, null, null, null, 'personal-care', null, 50, 0)),
  array['00000000-0000-0000-0000-0000000c7a01'::uuid],
  'service_slug=personal-care returns only providers linked to that service'
);

-- capability_slug filter narrows to the linked provider.
select is(
  (select array_agg(id order by id)
     from app.search_providers(null, null, null, null, null, 'manual-handling', 50, 0)),
  array['00000000-0000-0000-0000-0000000c7a01'::uuid],
  'capability_slug=manual-handling returns only providers linked to that capability'
);

-- limit_count is capped at 100 inside the function regardless of caller input.
-- We assert against the function source directly since seeding 100+ rows in a
-- pgTAP transaction is wasteful.
select ok(
  pg_get_functiondef(
    'app.search_providers(text,double precision,double precision,integer,text,text,integer,integer)'::regprocedure
  ) ~ 'least\(coalesce\(limit_count[^)]*\),\s*100\)',
  'app.search_providers caps limit_count at 100 inside the function body'
);

-- storage C-1: latitude / longitude / service_postcode were revoked from
-- anon in 0009 so the public directory no longer leaks precise PII. The
-- only location signal anon legitimately needs (distance_km) comes back
-- from the search RPC. service_radius_km is still anon-readable.
select throws_ok(
  $$ select latitude from public.provider_profiles where id = '00000000-0000-0000-0000-0000000c7a01' $$,
  '42501',
  null,
  'anon cannot SELECT latitude (revoked in 0009)'
);

select throws_ok(
  $$ select longitude from public.provider_profiles where id = '00000000-0000-0000-0000-0000000c7a01' $$,
  '42501',
  null,
  'anon cannot SELECT longitude (revoked in 0009)'
);

select throws_ok(
  $$ select service_postcode from public.provider_profiles where id = '00000000-0000-0000-0000-0000000c7a01' $$,
  '42501',
  null,
  'anon cannot SELECT service_postcode (revoked in 0009)'
);

select lives_ok(
  $$ select service_radius_km from public.provider_profiles where id = '00000000-0000-0000-0000-0000000c7a01' $$,
  'anon can still SELECT service_radius_km (kept in the narrow grant)'
);

-- ...and geocoded_at is an ops column that was never in the narrow grant.
select throws_ok(
  $$ select geocoded_at from public.provider_profiles where id = '00000000-0000-0000-0000-0000000c7a01' $$,
  '42501',
  null,
  'anon cannot SELECT geocoded_at (ops column, not in the narrow grant)'
);

-- Re-assert the 0004 boundary: phone is still private to anon.
select throws_ok(
  $$ select phone from public.provider_profiles where id = '00000000-0000-0000-0000-0000000c7a01' $$,
  '42501',
  null,
  'anon still cannot SELECT phone (0004 boundary holds)'
);

reset role;

select * from finish();
rollback;
