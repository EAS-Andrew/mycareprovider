-- pgTAP tests for public.meeting_proposals RLS, guard trigger, and the
-- future-only BEFORE INSERT trigger.

begin;

create extension if not exists pgtap;

select plan(11);

-- Fixtures. Provider fixture uses raw_app_meta_data.invited_by so post-0009
-- handle_new_auth_user honours the requested role.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000c821', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mp-rec@t.test',
   '{"role":"receiver","display_name":"MpRec"}'::jsonb,
   '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c822', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mp-prov@t.test',
   '{"role":"provider","display_name":"MpProv"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline, verified_at)
values ('00000000-0000-0000-0000-00000000c822', 'MP Provider', now());

-- Seed two contact requests (bypasses triggers so the contact_requests
-- rate-limit trigger does not demand a JWT claim): one pending, one
-- accepted - so we can assert proposals cannot be created on a pending one.
set local session_replication_role = replica;
insert into public.contact_requests (id, receiver_id, provider_id, subject, body, status)
values
  ('00000000-0000-0000-0000-00000000cc21', '00000000-0000-0000-0000-00000000c821',
   '00000000-0000-0000-0000-00000000c822', 'Accepted', 'body body body body', 'accepted'),
  ('00000000-0000-0000-0000-00000000cc22', '00000000-0000-0000-0000-00000000c821',
   '00000000-0000-0000-0000-00000000c822', 'Pending',  'body body body body', 'pending');
set local session_replication_role = origin;

-- =============================================================================
-- Receiver proposes a meeting on the accepted request
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c821',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

insert into public.meeting_proposals (
  id, contact_request_id, proposed_by, meeting_at, duration_minutes, location_mode, location_detail
) values (
  '00000000-0000-0000-0000-00000000cd21',
  '00000000-0000-0000-0000-00000000cc21',
  '00000000-0000-0000-0000-00000000c821',
  now() + interval '2 days', 60, 'video', 'https://meet.example.test/abc'
);

select is(
  (select count(*)::int from public.meeting_proposals where id = '00000000-0000-0000-0000-00000000cd21'),
  1,
  'proposer can create a proposal on an accepted contact request'
);

-- Same caller cannot create a proposal on the PENDING contact request.
select throws_ok(
  $$ insert into public.meeting_proposals (contact_request_id, proposed_by, meeting_at, duration_minutes, location_mode)
     values ('00000000-0000-0000-0000-00000000cc22',
             '00000000-0000-0000-0000-00000000c821',
             now() + interval '2 days', 60, 'video') $$,
  '42501',
  null,
  'proposal against a pending contact request is denied'
);

-- meeting_at in the past is rejected by the future-only trigger (post-0009
-- the trigger enforces a +1h lead time, so a past timestamp is caught).
select throws_ok(
  $$ insert into public.meeting_proposals (contact_request_id, proposed_by, meeting_at, duration_minutes, location_mode)
     values ('00000000-0000-0000-0000-00000000cc21',
             '00000000-0000-0000-0000-00000000c821',
             now() - interval '1 hour', 60, 'video') $$,
  '23514',
  'meeting_at must be at least 1 hour in the future',
  'past meeting_at raises 23514 via trigger'
);

-- contact M-1: +1h lead time is enforced in SQL. A meeting 30 minutes from
-- now is rejected even though it is technically in the future.
select throws_ok(
  $$ insert into public.meeting_proposals (contact_request_id, proposed_by, meeting_at, duration_minutes, location_mode)
     values ('00000000-0000-0000-0000-00000000cc21',
             '00000000-0000-0000-0000-00000000c821',
             now() + interval '30 minutes', 60, 'video') $$,
  '23514',
  'meeting_at must be at least 1 hour in the future',
  'sub-1h lead time rejected by future-only trigger'
);

-- Duration outside 15-240 is rejected by the CHECK constraint.
select throws_ok(
  $$ insert into public.meeting_proposals (contact_request_id, proposed_by, meeting_at, duration_minutes, location_mode)
     values ('00000000-0000-0000-0000-00000000cc21',
             '00000000-0000-0000-0000-00000000c821',
             now() + interval '2 days', 5, 'video') $$,
  '23514',
  null,
  'duration_minutes under 15 raises 23514'
);

-- Proposer cannot self-accept.
select throws_ok(
  $$ update public.meeting_proposals set status = 'accepted' where id = '00000000-0000-0000-0000-00000000cd21' $$,
  '42501',
  null,
  'proposer cannot self-accept their own proposal'
);

-- Proposer CAN cancel.
update public.meeting_proposals set status = 'cancelled' where id = '00000000-0000-0000-0000-00000000cd21';
select is(
  (select status from public.meeting_proposals where id = '00000000-0000-0000-0000-00000000cd21'),
  'cancelled',
  'proposer can cancel their own proposal'
);

reset role;

-- =============================================================================
-- Counter-party can accept a different proposal
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c821',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);
insert into public.meeting_proposals (
  id, contact_request_id, proposed_by, meeting_at, duration_minutes, location_mode
) values (
  '00000000-0000-0000-0000-00000000cd22',
  '00000000-0000-0000-0000-00000000cc21',
  '00000000-0000-0000-0000-00000000c821',
  now() + interval '3 days', 45, 'phone'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c822',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

update public.meeting_proposals set status = 'accepted' where id = '00000000-0000-0000-0000-00000000cd22';

select is(
  (select status from public.meeting_proposals where id = '00000000-0000-0000-0000-00000000cd22'),
  'accepted',
  'counter-party (provider) can accept a proposal'
);

select isnt(
  (select responded_at from public.meeting_proposals where id = '00000000-0000-0000-0000-00000000cd22'),
  null::timestamptz,
  'responded_at is stamped on accept'
);

-- Counter-party cannot re-accept a terminal row.
select throws_ok(
  $$ update public.meeting_proposals set status = 'declined' where id = '00000000-0000-0000-0000-00000000cd22' $$,
  '42501',
  null,
  'terminal status cannot be transitioned further'
);

-- Core fields are immutable.
select throws_ok(
  $$ update public.meeting_proposals set duration_minutes = 30 where id = '00000000-0000-0000-0000-00000000cd22' $$,
  '42501',
  null,
  'core fields frozen on owner path'
);

reset role;

select * from finish();
rollback;
