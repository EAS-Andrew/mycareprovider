-- pgTAP tests for public.verifications RLS, the AFTER INSERT auto-create
-- hook on documents, and the reviewed_at/reviewed_by touch trigger.

begin;

create extension if not exists pgtap;

select plan(10);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'v-owner@t.test',
   '{"role":"provider","display_name":"VOwner"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'v-other@t.test',
   '{"role":"provider","display_name":"VOther"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'v-admin@t.test',
   '{"role":"admin","display_name":"VAdmin"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline) values
  ('00000000-0000-0000-0000-0000000000c1', 'V1'),
  ('00000000-0000-0000-0000-0000000000c2', 'V2');

-- Owner uploads a document under RLS, which fires the AFTER INSERT trigger
-- (security definer) creating the verifications row.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c1',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

insert into public.documents (
  id, uploaded_by, provider_id, kind, title,
  storage_bucket, storage_path, mime_type, size_bytes
) values (
  '00000000-0000-0000-0000-00000000dc01',
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c1',
  'insurance', 'Public liability', 'provider-docs',
  'quarantine/00000000-0000-0000-0000-0000000000c1/dc01-pl.pdf',
  'application/pdf', 4321
);

-- =============================================================================
-- Auto-create
-- =============================================================================
select is(
  (select count(*)::int from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  1,
  'AFTER INSERT trigger created exactly one verifications row'
);

select is(
  (select state from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  'pending',
  'auto-created verifications row is in state=pending'
);

-- =============================================================================
-- Owner READ via RLS (joins through documents)
-- =============================================================================
select is(
  (select count(*)::int from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  1,
  'owner can SELECT verifications for own document'
);

-- Owner cannot INSERT directly (no INSERT policy, no INSERT grant).
select throws_ok(
  $$ insert into public.verifications (document_id, state) values ('00000000-0000-0000-0000-00000000dc01', 'approved') $$,
  '42501',
  null,
  'owner cannot INSERT into verifications directly'
);

-- Owner cannot UPDATE state (admin policy has USING, owner has no UPDATE policy).
update public.verifications
  set state = 'approved'
  where document_id = '00000000-0000-0000-0000-00000000dc01';

select is(
  (select state from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  'pending',
  'owner UPDATE of state is silently denied (no update policy -> 0 rows affected)'
);

reset role;

-- =============================================================================
-- Other provider cannot see another provider's verifications
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000c2',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

select is(
  (select count(*)::int from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  0,
  'another provider cannot SELECT someone else''s verifications row'
);

reset role;

-- =============================================================================
-- Admin workflow: pending -> in_review -> approved, then rejected+notes
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

update public.verifications
  set state = 'in_review'
  where document_id = '00000000-0000-0000-0000-00000000dc01';

select is(
  (select state from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  'in_review',
  'admin can transition pending -> in_review'
);

-- reviewed_by / reviewed_at should have been populated by the touch trigger.
select isnt(
  (select reviewed_at from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  null::timestamptz,
  'touch trigger populated reviewed_at on state transition'
);

update public.verifications
  set state = 'approved'
  where document_id = '00000000-0000-0000-0000-00000000dc01';

select is(
  (select state from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  'approved',
  'admin can transition in_review -> approved'
);

-- Rejected state carries notes.
update public.verifications
  set state = 'rejected', notes = 'blurry scan'
  where document_id = '00000000-0000-0000-0000-00000000dc01';

select is(
  (select state || '|' || notes from public.verifications where document_id = '00000000-0000-0000-0000-00000000dc01'),
  'rejected|blurry scan',
  'rejected state can carry notes'
);

reset role;

select * from finish();
rollback;
