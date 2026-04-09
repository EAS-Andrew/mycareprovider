-- pgTAP tests for public.documents RLS policies, the exactly-one-subject
-- CHECK, the owner-path guard trigger, and the auto-verification AFTER INSERT
-- trigger (creation is asserted in documents.test.sql; verifications.test.sql
-- asserts the downstream row contents).

begin;

create extension if not exists pgtap;

select plan(14);

-- -----------------------------------------------------------------------------
-- Fixture users + their provider_profiles rows. provider_profiles.id equals
-- profiles.id by the one-to-one convention, so we use the same uuid for both.
-- Non-receiver fixtures set raw_app_meta_data.invited_by so the post-0009
-- handle_new_auth_user trigger honours the requested role.
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'doc-owner@t.test',
   '{"role":"provider","display_name":"DocOwner"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'doc-other@t.test',
   '{"role":"provider","display_name":"DocOther"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000bc', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'doc-victim@t.test',
   '{"role":"receiver","display_name":"Victim"}'::jsonb,
   '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000bd', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'doc-admin@t.test',
   '{"role":"admin","display_name":"DocAdmin"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline) values
  ('00000000-0000-0000-0000-0000000000b1', 'Owner headline'),
  ('00000000-0000-0000-0000-0000000000b2', 'Other headline');

-- =============================================================================
-- Owner uploads their own document (happy path) - AFTER INSERT trigger must
-- create the paired verifications row.
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000b1',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

insert into public.documents (
  id, uploaded_by, provider_id, kind, title,
  storage_bucket, storage_path, mime_type, size_bytes
) values (
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000b1',
  'dbs', 'DBS certificate',
  'provider-docs',
  'quarantine/00000000-0000-0000-0000-0000000000b1/d1-dbs.pdf',
  'application/pdf', 12345
);

select is(
  (select count(*)::int from public.documents where id = '00000000-0000-0000-0000-0000000000d1'),
  1,
  'owner can INSERT + SELECT their own document (single subject FK)'
);

-- exactly-one-subject CHECK: zero FKs must fail.
select throws_ok(
  $$ insert into public.documents (uploaded_by, kind, title, storage_bucket, storage_path, mime_type, size_bytes)
     values ('00000000-0000-0000-0000-0000000000b1', 'other', 'orphan', 'provider-docs',
             'quarantine/00000000-0000-0000-0000-0000000000b1/orphan.pdf', 'application/pdf', 1) $$,
  '23514',
  null,
  'INSERT with zero subject FKs is rejected by documents_exactly_one_subject CHECK'
);

-- Two subject FKs: rejected. Post-0009, documents_owner_insert WITH CHECK
-- pins every non-provider FK (receiver_id / care_plan_id / visit_id /
-- message_id / provider_company_id) to NULL, so RLS fires first (42501)
-- before the exactly-one-subject CHECK (23514) gets a chance. Both errors
-- defend the same invariant; 42501 is the outer wall that now catches it.
select throws_ok(
  $$ insert into public.documents (uploaded_by, provider_id, receiver_id, kind, title, storage_bucket, storage_path, mime_type, size_bytes)
     values ('00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000b1',
             'other', 'dual', 'provider-docs',
             'quarantine/00000000-0000-0000-0000-0000000000b1/dual.pdf', 'application/pdf', 1) $$,
  '42501',
  null,
  'INSERT with two subject FKs is rejected (RLS pins non-provider FKs to NULL before CHECK fires)'
);

-- Status must start as 'quarantined' (enforced via the owner_insert WITH CHECK
-- policy's status='quarantined' clause, plus the CHECK constraint). Owner
-- cannot insert directly as 'available'.
select throws_ok(
  $$ insert into public.documents (uploaded_by, provider_id, kind, title, storage_bucket, storage_path, mime_type, size_bytes, status)
     values ('00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000b1',
             'insurance', 'direct-avail', 'provider-docs',
             'quarantine/00000000-0000-0000-0000-0000000000b1/direct-avail.pdf',
             'application/pdf', 1, 'available') $$,
  '42501',
  null,
  'owner cannot INSERT with status=available (blocked by owner_insert WITH CHECK)'
);

-- Owner cannot UPDATE status (guard trigger rejects).
select throws_ok(
  $$ update public.documents set status = 'available' where id = '00000000-0000-0000-0000-0000000000d1' $$,
  '42501',
  'status changes are admin-only',
  'owner cannot update status'
);

-- rls#3 / storage M-5: owner cannot attribute a document to a victim via a
-- non-provider subject FK. The 0009 WITH CHECK pins every non-provider FK
-- (receiver_id / care_plan_id / visit_id / message_id / provider_company_id)
-- to NULL for Phase 1a.
select throws_ok(
  $$ insert into public.documents (uploaded_by, receiver_id, kind, title, storage_bucket, storage_path, mime_type, size_bytes)
     values ('00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000bc',
             'other', 'attributed-to-victim', 'provider-docs',
             'quarantine/00000000-0000-0000-0000-0000000000b1/victim.pdf',
             'application/pdf', 1) $$,
  '42501',
  null,
  'owner cannot attribute a document to another user via receiver_id (subject-FK attack)'
);

-- Insert a second document so we can soft-delete it without losing d1 for
-- the downstream admin-path assertions.
insert into public.documents (
  id, uploaded_by, provider_id, kind, title,
  storage_bucket, storage_path, mime_type, size_bytes
) values (
  '00000000-0000-0000-0000-0000000000d2',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000b1',
  'certification', 'First aid cert',
  'provider-docs',
  'quarantine/00000000-0000-0000-0000-0000000000b1/d2-firstaid.pdf',
  'application/pdf', 2222
);

-- rls#7: owner soft-delete now flows through app.soft_delete_document. A
-- direct UPDATE that flips deleted_at would be caught by the guard trigger
-- on a subsequent read (documents_owner_read filters deleted_at IS NULL).
select app.soft_delete_document('00000000-0000-0000-0000-0000000000d2');

-- After the helper, the owner can no longer SEE the row via RLS (the
-- deleted_at IS NULL filter in documents_owner_read hides it).
select is(
  (select count(*)::int from public.documents where id = '00000000-0000-0000-0000-0000000000d2'),
  0,
  'after app.soft_delete_document, the row is hidden from the owner via RLS'
);

reset role;

-- =============================================================================
-- Other provider cannot see b1's documents
-- =============================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000b2',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.documents where id = '00000000-0000-0000-0000-0000000000d1'),
  0,
  'another provider cannot SELECT someone else''s document'
);

-- Other provider also cannot INSERT a document claiming b1 as provider_id
-- (WITH CHECK forces provider_id = current_profile_id or null).
select throws_ok(
  $$ insert into public.documents (uploaded_by, provider_id, kind, title, storage_bucket, storage_path, mime_type, size_bytes)
     values ('00000000-0000-0000-0000-0000000000b2',
             '00000000-0000-0000-0000-0000000000b1',
             'dbs', 'forged', 'provider-docs',
             'quarantine/00000000-0000-0000-0000-0000000000b2/forged.pdf',
             'application/pdf', 1) $$,
  '42501',
  null,
  'provider cannot upload a document against another provider_id'
);

reset role;

-- =============================================================================
-- Admin can transition status
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000bd',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

update public.documents
  set status = 'available'
  where id = '00000000-0000-0000-0000-0000000000d1';

select is(
  (select status from public.documents where id = '00000000-0000-0000-0000-0000000000d1'),
  'available',
  'admin can update document status freely'
);

-- Admin can SELECT any document (even soft-deleted ones via the admin policy).
update public.documents set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000d1';

select is(
  (select count(*)::int from public.documents where id = '00000000-0000-0000-0000-0000000000d1'),
  1,
  'admin can SELECT soft-deleted document (documents_admin policy has no deleted_at filter)'
);

-- Admin can reject with a reason.
update public.documents
  set status = 'rejected', rejected_reason = 'illegible', deleted_at = null
  where id = '00000000-0000-0000-0000-0000000000d1';

select is(
  (select status || '|' || rejected_reason from public.documents where id = '00000000-0000-0000-0000-0000000000d1'),
  'rejected|illegible',
  'admin can set rejected + rejected_reason in a single update'
);

-- Auto-verification trigger fired once on the original owner INSERT.
select is(
  (select count(*)::int from public.verifications where document_id = '00000000-0000-0000-0000-0000000000d1'),
  1,
  'AFTER INSERT trigger on documents created exactly one verifications row'
);

reset role;

-- rls#5: the service-role promote path (lib/documents/promote.ts) must be
-- able to flip status without tripping tg_documents_guard. Insert a fresh
-- quarantined row as admin, then switch to service_role and promote it.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000bd',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

insert into public.documents (
  id, uploaded_by, provider_id, kind, title,
  storage_bucket, storage_path, mime_type, size_bytes, status
) values (
  '00000000-0000-0000-0000-0000000000d3',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000b1',
  'dbs', 'Service promote target',
  'provider-docs',
  'quarantine/00000000-0000-0000-0000-0000000000b1/d3.pdf',
  'application/pdf', 3333, 'quarantined'
);

reset role;

set local role service_role;
select set_config('request.jwt.claims', '', true);

update public.documents
  set status = 'available'
  where id = '00000000-0000-0000-0000-0000000000d3';

select is(
  (select status from public.documents where id = '00000000-0000-0000-0000-0000000000d3'),
  'available',
  'service_role can promote status without tripping tg_documents_guard'
);

reset role;

select * from finish();
rollback;
