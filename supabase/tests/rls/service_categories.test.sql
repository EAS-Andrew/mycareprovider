-- pgTAP tests for public.service_categories (representative of all three
-- pure-reference tables: service_categories, capabilities, certifications).
-- World-readable, admin-writable, RLS enabled so default is deny.
--
-- Runs under `supabase test db`: wrapped in a transaction, rolled back at
-- the end. Identities are switched via SET LOCAL ROLE + request.jwt.claims,
-- same pattern as profiles.test.sql / documents.test.sql.

begin;

create extension if not exists pgtap;

select plan(10);

-- -----------------------------------------------------------------------------
-- Fixture users: one non-admin, one admin. handle_new_auth_user provisions
-- the profiles rows from raw_user_meta_data.role.
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sc-user@t.test',
   '{"role":"receiver","display_name":"SCUser"}'::jsonb,
   '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sc-admin@t.test',
   '{"role":"admin","display_name":"SCAdmin"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

-- =============================================================================
-- Seed rows landed via the migration
-- =============================================================================
select is(
  (select count(*)::int from public.service_categories where slug = 'personal-care'),
  1,
  'migration seeded personal-care category'
);

select is(
  (select count(*)::int from public.service_categories where slug = 'live-in-care'),
  1,
  'migration seeded live-in-care category'
);

-- =============================================================================
-- Anonymous browsing: world-readable, no write privileges
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select ok(
  (select count(*) from public.service_categories) >= 8,
  'anon can SELECT seeded service_categories rows'
);

-- anon has no INSERT/UPDATE/DELETE column grant -> permission denied at grant
-- check, before RLS is even evaluated.
select throws_ok(
  $$ insert into public.service_categories (slug, name) values ('hack', 'Hack') $$,
  '42501',
  null,
  'anon cannot INSERT into service_categories (no grant)'
);

reset role;

-- =============================================================================
-- Authenticated non-admin: world-readable, but writes are filtered away
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c1',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select ok(
  (select count(*) from public.service_categories) >= 8,
  'authenticated non-admin can SELECT all rows via public_read'
);

-- Non-admin INSERT is rejected by the admin_write policy WITH CHECK.
select throws_ok(
  $$ insert into public.service_categories (slug, name) values ('sneak', 'Sneak') $$,
  '42501',
  null,
  'authenticated non-admin cannot INSERT (admin_write WITH CHECK)'
);

-- Non-admin UPDATE silently affects zero rows (no USING clause matches).
update public.service_categories set name = 'Hijacked' where slug = 'personal-care';
select is(
  (select name from public.service_categories where slug = 'personal-care'),
  'Personal care',
  'authenticated non-admin UPDATE is filtered to zero rows by RLS'
);

-- Non-admin DELETE silently affects zero rows (no USING clause matches).
delete from public.service_categories where slug = 'personal-care';
select is(
  (select count(*)::int from public.service_categories where slug = 'personal-care'),
  1,
  'authenticated non-admin DELETE is filtered to zero rows by RLS'
);

reset role;

-- =============================================================================
-- Admin: full write access via admin_write policy
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000cd',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

insert into public.service_categories (slug, name, description, sort_order)
  values ('respite-care', 'Respite care', 'Short-term cover for primary carers.', 90);

select is(
  (select count(*)::int from public.service_categories where slug = 'respite-care'),
  1,
  'admin can INSERT a new service_category'
);

delete from public.service_categories where slug = 'respite-care';

select is(
  (select count(*)::int from public.service_categories where slug = 'respite-care'),
  0,
  'admin can DELETE a service_category'
);

reset role;

select * from finish();
rollback;
