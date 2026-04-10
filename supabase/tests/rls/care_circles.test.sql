-- pgTAP tests for care_circles, care_circle_members, family_authorisations,
-- family_invitations RLS policies, guard triggers, and app.is_care_circle_member().

begin;

create extension if not exists pgtap;

select plan(24);

-- -----------------------------------------------------------------------------
-- Fixture users. Non-receiver fixtures set raw_app_meta_data.invited_by so
-- the post-0009 handle_new_auth_user trigger honours the requested role.
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  -- Receiver who owns the circle
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'receiver-c4@t.test',
   '{"role":"receiver","display_name":"ReceiverC4"}'::jsonb,
   '{}'::jsonb, now(), now()),
  -- Primary family member
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'primary-fm@t.test',
   '{"role":"family_member","display_name":"PrimaryFM"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  -- Regular family member
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member-fm@t.test',
   '{"role":"family_member","display_name":"MemberFM"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  -- Outsider (not in circle)
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'outsider-c4@t.test',
   '{"role":"receiver","display_name":"OutsiderC4"}'::jsonb,
   '{}'::jsonb, now(), now()),
  -- Admin
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-c4@t.test',
   '{"role":"admin","display_name":"AdminC4"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

-- =============================================================================
-- 1. Receiver can create their own care circle
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

insert into public.care_circles (id, receiver_id, name) values
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c1', 'Test Circle');

select ok(
  (select count(*) = 1 from public.care_circles where id = '00000000-0000-0000-0000-0000000000cc'),
  'receiver can create own care circle'
);

-- =============================================================================
-- 2. Receiver can read their own circle
-- =============================================================================
select ok(
  (select count(*) = 1 from public.care_circles where receiver_id = '00000000-0000-0000-0000-0000000000c1'),
  'receiver can read own circle'
);

-- =============================================================================
-- 3. Receiver can add members to their circle
-- =============================================================================
insert into public.care_circle_members (id, circle_id, profile_id, role, invited_by, accepted_at)
values
  ('00000000-0000-0000-0000-0000000000m1', '00000000-0000-0000-0000-0000000000cc',
   '00000000-0000-0000-0000-0000000000c2', 'primary',
   '00000000-0000-0000-0000-0000000000c1', now());

select ok(
  (select count(*) = 1 from public.care_circle_members where id = '00000000-0000-0000-0000-0000000000m1'),
  'receiver can add primary family member'
);

insert into public.care_circle_members (id, circle_id, profile_id, role, invited_by, accepted_at)
values
  ('00000000-0000-0000-0000-0000000000m2', '00000000-0000-0000-0000-0000000000cc',
   '00000000-0000-0000-0000-0000000000c3', 'member',
   '00000000-0000-0000-0000-0000000000c1', now());

select ok(
  (select count(*) = 1 from public.care_circle_members where id = '00000000-0000-0000-0000-0000000000m2'),
  'receiver can add regular family member'
);

-- =============================================================================
-- 4. Outsider cannot read the circle
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c4',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select ok(
  (select count(*) = 0 from public.care_circles where id = '00000000-0000-0000-0000-0000000000cc'),
  'outsider cannot read the circle'
);

-- =============================================================================
-- 5. Outsider cannot see circle members
-- =============================================================================
select ok(
  (select count(*) = 0 from public.care_circle_members where circle_id = '00000000-0000-0000-0000-0000000000cc'),
  'outsider cannot see circle members'
);

-- =============================================================================
-- 6. Outsider cannot insert members into the circle
-- =============================================================================
select throws_ok(
  $$insert into public.care_circle_members (circle_id, profile_id, role, invited_by)
    values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c4',
            'member', '00000000-0000-0000-0000-0000000000c4')$$,
  null, null,
  'outsider cannot insert members'
);

-- =============================================================================
-- 7. Primary family member can read the circle
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c2',
    'role',     'authenticated',
    'app_role', 'family_member'
  )::text,
  true
);

select ok(
  (select count(*) = 1 from public.care_circles where id = '00000000-0000-0000-0000-0000000000cc'),
  'primary family member can read the circle'
);

-- =============================================================================
-- 8. Primary family member can see other members
-- =============================================================================
select ok(
  (select count(*) >= 1 from public.care_circle_members where circle_id = '00000000-0000-0000-0000-0000000000cc'),
  'primary family member can see circle members'
);

-- =============================================================================
-- 9. Regular member can read the circle
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c3',
    'role',     'authenticated',
    'app_role', 'family_member'
  )::text,
  true
);

select ok(
  (select count(*) = 1 from public.care_circles where id = '00000000-0000-0000-0000-0000000000cc'),
  'regular family member can read the circle'
);

-- =============================================================================
-- 10. app.is_care_circle_member works for active members
-- =============================================================================
select ok(
  app.is_care_circle_member('00000000-0000-0000-0000-0000000000cc'),
  'is_care_circle_member returns true for active member'
);

-- =============================================================================
-- 11. app.is_care_circle_member returns false for outsider
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c4',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select ok(
  not app.is_care_circle_member('00000000-0000-0000-0000-0000000000cc'),
  'is_care_circle_member returns false for outsider'
);

-- =============================================================================
-- 12. app.is_care_circle_member returns true for the receiver (circle owner)
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
  app.is_care_circle_member('00000000-0000-0000-0000-0000000000cc'),
  'is_care_circle_member returns true for receiver/owner'
);

-- =============================================================================
-- 13. Receiver can create family invitations
-- =============================================================================
insert into public.family_invitations (id, circle_id, email, role, invited_by, token)
values
  ('00000000-0000-0000-0000-0000000000i1', '00000000-0000-0000-0000-0000000000cc',
   'newmember@t.test', 'member', '00000000-0000-0000-0000-0000000000c1',
   'test-invite-token-001');

select ok(
  (select count(*) = 1 from public.family_invitations where id = '00000000-0000-0000-0000-0000000000i1'),
  'receiver can create family invitations'
);

-- =============================================================================
-- 14. Outsider cannot see family invitations
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c4',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select ok(
  (select count(*) = 0 from public.family_invitations where circle_id = '00000000-0000-0000-0000-0000000000cc'),
  'outsider cannot see family invitations'
);

-- =============================================================================
-- 15. Anon can read unexpired invitations (for sign-up page)
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

select ok(
  (select count(*) >= 1 from public.family_invitations where token = 'test-invite-token-001'),
  'anon can read unexpired invitations by token'
);

-- =============================================================================
-- 16. Family member can upload authorisation document (setup)
-- =============================================================================
-- First insert the document as the family member
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c2',
    'role',     'authenticated',
    'app_role', 'family_member'
  )::text,
  true
);

-- Insert a document for the receiver
insert into public.documents (
  id, uploaded_by, receiver_id, kind, title,
  storage_bucket, storage_path, mime_type, size_bytes
) values (
  '00000000-0000-0000-0000-0000000000d5',
  '00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000c1',
  'authorisation', 'PoA Document',
  'receiver-docs', 'quarantine/00000000-0000-0000-0000-0000000000c2/test-poa.pdf',
  'application/pdf', 1024
);

select ok(
  (select count(*) = 1 from public.documents where id = '00000000-0000-0000-0000-0000000000d5'),
  'family member can insert receiver document'
);

-- =============================================================================
-- 17. Family member can create authorisation record
-- =============================================================================
insert into public.family_authorisations (
  id, circle_member_id, document_id, authorisation_type, notes
) values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000m1',
  '00000000-0000-0000-0000-0000000000d5',
  'power_of_attorney', 'Test PoA'
);

select ok(
  (select count(*) = 1 from public.family_authorisations where id = '00000000-0000-0000-0000-0000000000a1'),
  'family member can create authorisation record'
);

-- =============================================================================
-- 18. Family member can read their own authorisation
-- =============================================================================
select ok(
  (select count(*) = 1 from public.family_authorisations where circle_member_id = '00000000-0000-0000-0000-0000000000m1'),
  'family member can read own authorisation'
);

-- =============================================================================
-- 19. Receiver can read authorisations in their circle
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
  (select count(*) = 1 from public.family_authorisations where id = '00000000-0000-0000-0000-0000000000a1'),
  'receiver can read authorisations in their circle'
);

-- =============================================================================
-- 20. Outsider cannot read authorisations
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c4',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select ok(
  (select count(*) = 0 from public.family_authorisations where id = '00000000-0000-0000-0000-0000000000a1'),
  'outsider cannot read authorisations'
);

-- =============================================================================
-- 21. Non-admin cannot set verified_at on family_authorisations
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c2',
    'role',     'authenticated',
    'app_role', 'family_member'
  )::text,
  true
);

select throws_ok(
  $$update public.family_authorisations
    set verified_at = now()
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null,
  'non-admin cannot set verified_at'
);

-- =============================================================================
-- 22. Admin can set verified_at
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c5',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

update public.family_authorisations
  set verified_at = now(), verified_by = '00000000-0000-0000-0000-0000000000c5'
  where id = '00000000-0000-0000-0000-0000000000a1';

select ok(
  (select verified_at is not null from public.family_authorisations where id = '00000000-0000-0000-0000-0000000000a1'),
  'admin can set verified_at'
);

-- =============================================================================
-- 23. Admin has full access to care_circles
-- =============================================================================
select ok(
  (select count(*) >= 1 from public.care_circles),
  'admin can read all care circles'
);

-- =============================================================================
-- 24. Unique constraint: one circle per receiver
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

select throws_ok(
  $$insert into public.care_circles (receiver_id, name)
    values ('00000000-0000-0000-0000-0000000000c1', 'Duplicate Circle')$$,
  '23505', null,
  'one circle per receiver constraint enforced'
);

select * from finish();

rollback;
