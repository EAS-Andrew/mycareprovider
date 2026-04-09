-- pgTAP tests for public.contact_requests RLS and the guard trigger.

begin;

create extension if not exists pgtap;

select plan(13);

-- -----------------------------------------------------------------------------
-- Fixture users. Suffixes are c8xx to avoid the seed.sql / provider_search
-- namespaces. Non-receiver fixtures set raw_app_meta_data.invited_by so
-- post-0009 handle_new_auth_user honours the requested role.
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rec1@t.test',
   '{"role":"receiver","display_name":"Rec1"}'::jsonb,
   '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c802', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'prov-verified@t.test',
   '{"role":"provider","display_name":"ProvVer"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c803', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'prov-unverified@t.test',
   '{"role":"provider","display_name":"ProvUnver"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c804', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'prov-other@t.test',
   '{"role":"provider","display_name":"ProvOther"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c8ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cr-admin@t.test',
   '{"role":"admin","display_name":"CRAdmin"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline, verified_at) values
  ('00000000-0000-0000-0000-00000000c802', 'Verified',   now()),
  ('00000000-0000-0000-0000-00000000c803', 'Unverified', null),
  ('00000000-0000-0000-0000-00000000c804', 'Other',      now());

-- =============================================================================
-- Receiver inserts to verified provider -> ok
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c801',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

insert into public.contact_requests (id, receiver_id, provider_id, subject, body)
values (
  '00000000-0000-0000-0000-00000000cc01',
  '00000000-0000-0000-0000-00000000c801',
  '00000000-0000-0000-0000-00000000c802',
  'Care needed for mum',
  'We would like to discuss hourly care arrangements in Leeds.'
);

select is(
  (select count(*)::int from public.contact_requests where id = '00000000-0000-0000-0000-00000000cc01'),
  1,
  'receiver can create a pending contact request to a verified provider'
);

-- Receiver cannot insert against an unverified provider.
select throws_ok(
  $$ insert into public.contact_requests (receiver_id, provider_id, subject, body)
     values ('00000000-0000-0000-0000-00000000c801',
             '00000000-0000-0000-0000-00000000c803',
             'Hello there',
             'Would like to talk - body is long enough.') $$,
  '42501',
  null,
  'receiver cannot create a contact request against an unverified provider'
);

reset role;

-- =============================================================================
-- Provider A can read their own inbox; provider B cannot see A's rows
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c802',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.contact_requests where id = '00000000-0000-0000-0000-00000000cc01'),
  1,
  'target provider can read the contact request in their inbox'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c804',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.contact_requests where id = '00000000-0000-0000-0000-00000000cc01'),
  0,
  'another provider cannot see a contact request not targeted at them'
);

reset role;

-- =============================================================================
-- Provider accepts the request
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c802',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

update public.contact_requests
  set status = 'accepted'
  where id = '00000000-0000-0000-0000-00000000cc01';

select is(
  (select status from public.contact_requests where id = '00000000-0000-0000-0000-00000000cc01'),
  'accepted',
  'provider can transition pending -> accepted'
);

select isnt(
  (select responded_at from public.contact_requests where id = '00000000-0000-0000-0000-00000000cc01'),
  null::timestamptz,
  'guard trigger stamps responded_at on transition'
);

-- Provider cannot reverse the transition.
select throws_ok(
  $$ update public.contact_requests set status = 'pending' where id = '00000000-0000-0000-0000-00000000cc01' $$,
  '42501',
  null,
  'provider cannot transition accepted -> pending'
);

reset role;

-- =============================================================================
-- Receiver withdraw path (on a SECOND, still-pending request)
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c801',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

insert into public.contact_requests (id, receiver_id, provider_id, subject, body)
values (
  '00000000-0000-0000-0000-00000000cc02',
  '00000000-0000-0000-0000-00000000c801',
  '00000000-0000-0000-0000-00000000c804',
  'Hello Other',
  'Second contact request for withdraw test - long enough body.'
);

update public.contact_requests
  set status = 'withdrawn'
  where id = '00000000-0000-0000-0000-00000000cc02';

select is(
  (select status from public.contact_requests where id = '00000000-0000-0000-0000-00000000cc02'),
  'withdrawn',
  'receiver can withdraw their own pending request'
);

-- Receiver cannot withdraw the already-accepted one.
select throws_ok(
  $$ update public.contact_requests set status = 'withdrawn' where id = '00000000-0000-0000-0000-00000000cc01' $$,
  '42501',
  null,
  'receiver cannot withdraw a request that is already accepted'
);

-- Receiver cannot hijack the subject/body via update.
select throws_ok(
  $$ update public.contact_requests set subject = 'hijacked subject' where id = '00000000-0000-0000-0000-00000000cc01' $$,
  '42501',
  null,
  'core fields are immutable after insert (owner path)'
);

-- Receiver cannot insert masquerading as a provider role.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c802',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select throws_ok(
  $$ insert into public.contact_requests (receiver_id, provider_id, subject, body)
     values ('00000000-0000-0000-0000-00000000c802',
             '00000000-0000-0000-0000-00000000c804',
             'Provider outreach?',
             'Providers should not be allowed to create contact requests.') $$,
  '42501',
  null,
  'a provider-role caller cannot create a contact request'
);

reset role;

-- =============================================================================
-- rls#9 / contact H-1: non-admin parties cannot censor (soft-delete) a
-- contact_request row. Only admins may set deleted_at.
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c802',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select throws_ok(
  $$ update public.contact_requests set deleted_at = now() where id = '00000000-0000-0000-0000-00000000cc01' $$,
  '42501',
  null,
  'provider party cannot soft-delete (censor) a contact_request row'
);

reset role;

-- Admin can still soft-delete.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c8ad',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

update public.contact_requests
  set deleted_at = now()
  where id = '00000000-0000-0000-0000-00000000cc02';

select isnt(
  (select deleted_at from public.contact_requests where id = '00000000-0000-0000-0000-00000000cc02'),
  null::timestamptz,
  'admin can soft-delete a contact_request row'
);

reset role;

select * from finish();
rollback;
