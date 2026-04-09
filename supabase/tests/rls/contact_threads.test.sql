-- pgTAP tests for public.contact_threads: the AFTER UPDATE auto-create
-- trigger on contact_requests, and the party-only read policy.

begin;

create extension if not exists pgtap;

select plan(6);

-- Fixtures. Non-receiver fixtures set raw_app_meta_data.invited_by so the
-- post-0009 handle_new_auth_user trigger honours the requested role.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000c841', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ct-rec@t.test',
   '{"role":"receiver","display_name":"CtRec"}'::jsonb,
   '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c842', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ct-prov@t.test',
   '{"role":"provider","display_name":"CtProv"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c843', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ct-third@t.test',
   '{"role":"provider","display_name":"CtThird"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline, verified_at) values
  ('00000000-0000-0000-0000-00000000c842', 'Prov', now()),
  ('00000000-0000-0000-0000-00000000c843', 'Third', now());

-- Two contact requests, both pending. Bypass user triggers during the
-- fixture insert so the new rate-limit trigger does not demand a JWT claim.
set local session_replication_role = replica;
insert into public.contact_requests (id, receiver_id, provider_id, subject, body)
values
  ('00000000-0000-0000-0000-00000000cc41', '00000000-0000-0000-0000-00000000c841',
   '00000000-0000-0000-0000-00000000c842', 'First subject', 'body body body body body'),
  ('00000000-0000-0000-0000-00000000cc42', '00000000-0000-0000-0000-00000000c841',
   '00000000-0000-0000-0000-00000000c842', 'Second subject','body body body body body');
set local session_replication_role = origin;

-- No thread exists yet.
select is(
  (select count(*)::int from public.contact_threads),
  0,
  'no contact_thread rows before any acceptance'
);

-- Accept the first request. The tg_contact_requests_guard trigger requires
-- a recognised caller identity to authorise a status transition, so bypass
-- it for the seed path by stamping an admin JWT on the session. Once the
-- row is accepted we reset role so the subsequent party-visibility checks
-- run under the right identities.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c841',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);
update public.contact_requests set status = 'accepted' where id = '00000000-0000-0000-0000-00000000cc41';
reset role;

select is(
  (select count(*)::int from public.contact_threads where contact_request_id = '00000000-0000-0000-0000-00000000cc41'),
  1,
  'AFTER UPDATE trigger auto-creates a thread on pending -> accepted'
);

-- Decline the second: no thread is created.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c841',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);
update public.contact_requests set status = 'declined' where id = '00000000-0000-0000-0000-00000000cc42';
reset role;

select is(
  (select count(*)::int from public.contact_threads where contact_request_id = '00000000-0000-0000-0000-00000000cc42'),
  0,
  'no thread is created on pending -> declined'
);

-- =============================================================================
-- Party read access
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c841',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select is(
  (select count(*)::int from public.contact_threads where contact_request_id = '00000000-0000-0000-0000-00000000cc41'),
  1,
  'receiver party can read the thread'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c842',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.contact_threads where contact_request_id = '00000000-0000-0000-0000-00000000cc41'),
  1,
  'provider party can read the thread'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c843',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.contact_threads where contact_request_id = '00000000-0000-0000-0000-00000000cc41'),
  0,
  'unrelated third party cannot read the thread'
);

reset role;

select * from finish();
rollback;
