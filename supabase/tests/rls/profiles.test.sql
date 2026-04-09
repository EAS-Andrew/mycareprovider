-- pgTAP tests for public.profiles RLS policies.
--
-- Runs under `supabase test db`, which wraps each file in a transaction and
-- rolls back at the end. We directly seed auth.users (letting the
-- on_auth_user_created trigger populate profiles) and switch identities via
-- SET LOCAL ROLE + request.jwt.claims rather than pulling in
-- supabase-test-helpers, to keep dependencies minimal.

begin;

create extension if not exists pgtap;

select plan(14);

-- -----------------------------------------------------------------------------
-- Fixture users. IDs are memorable so assertions stay readable.
--
-- After 0009, handle_new_auth_user only honours raw_user_meta_data.role when
-- raw_app_meta_data.invited_by is set (the admin-invite path). Non-receiver
-- fixtures therefore set invited_by explicitly. An additional row below
-- asserts the coercion for a public signup that tries to ask for admin.
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'receiver1@t.test',
   '{"role":"receiver","display_name":"R1"}'::jsonb,
   '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'provider1@t.test',
   '{"role":"provider","display_name":"P1"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin1@t.test',
   '{"role":"admin","display_name":"A1"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  -- Public signup pretending to be admin. raw_app_meta_data is empty, so
  -- handle_new_auth_user must coerce the role to receiver.
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'attacker@t.test',
   '{"role":"admin","display_name":"Mallory"}'::jsonb,
   '{}'::jsonb, now(), now());

-- The invite-path admin still lands as admin.
select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-000000000003'),
  'admin',
  'handle_new_auth_user honours raw_user_meta_data.role on the invite path'
);

-- The public-signup "admin" is coerced to receiver (finding auth#1 / rls#1).
select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000aa'),
  'receiver',
  'handle_new_auth_user coerces public signups to receiver even if role=admin is requested'
);

-- =============================================================================
-- Anonymous browsing - public directory policy
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000002'),
  1,
  'anon can read provider row via public directory policy'
);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  0,
  'anon cannot read receiver row'
);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000003'),
  0,
  'anon cannot read admin row'
);

reset role;

-- =============================================================================
-- Receiver acting on their own row
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000001',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  1,
  'receiver can read own profile'
);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000003'),
  0,
  'receiver cannot read admin profile'
);

-- Self-update of display_name is allowed.
update public.profiles
  set display_name = 'Updated Name'
  where id = '00000000-0000-0000-0000-000000000001';

select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  'Updated Name',
  'receiver can update own display_name'
);

-- Self-promotion to admin is blocked by the guard trigger.
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501',
  'role changes are admin-only',
  'receiver cannot self-promote to admin'
);

-- Updating someone else's row silently affects zero rows (RLS USING filter).
update public.profiles
  set display_name = 'Hacked'
  where id = '00000000-0000-0000-0000-000000000002';

select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-000000000002'),
  'P1',
  'receiver cannot update another user row (RLS filters to zero)'
);

-- Inserting an arbitrary row (including admin promotion) is blocked.
select throws_ok(
  $$ insert into public.profiles (id, role) values ('00000000-0000-0000-0000-0000000000ff', 'admin') $$,
  '42501',
  null,
  'non-admin insert is rejected by RLS WITH CHECK'
);

reset role;

-- =============================================================================
-- Admin acting on any row
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-000000000003',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

select ok(
  (select count(*) from public.profiles) >= 3,
  'admin can read all profiles'
);

-- Admin can change another user's role.
update public.profiles
  set role = 'family_member'
  where id = '00000000-0000-0000-0000-000000000001';

select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  'family_member',
  'admin can change another user role'
);

-- Admin can soft-delete a provider; anon then stops seeing the row.
update public.profiles
  set deleted_at = now()
  where id = '00000000-0000-0000-0000-000000000002';

reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000002'),
  0,
  'soft-deleted provider is invisible to anon'
);

reset role;

select * from finish();
rollback;
