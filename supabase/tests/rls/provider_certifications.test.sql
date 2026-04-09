-- pgTAP tests for public.provider_certifications:
--   - owner INSERT / UPDATE / soft-delete
--   - guard trigger blocks hard DELETE on the non-admin path (throws_ok)
--   - partial unique index: at most one active row per (provider, cert type)
--   - anon column-level grant narrowing (no `reference`)
--   - "draft not leaked" verified_at gate for anon
--
-- Runs under `supabase test db`: wrapped in a transaction, rolled back at
-- the end.

begin;

create extension if not exists pgtap;

select plan(12);

-- -----------------------------------------------------------------------------
-- Fixture users + provider_profiles
--
-- pc1 = unverified provider
-- pc2 = verified provider
-- pcd = admin
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pc1@t.test',
   '{"role":"provider","display_name":"PC1"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pc2@t.test',
   '{"role":"provider","display_name":"PC2"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000fd', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pcd@t.test',
   '{"role":"admin","display_name":"PCD"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline, verified_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'Draft pc1',    null),
  ('00000000-0000-0000-0000-0000000000f2', 'Verified pc2', now());

-- =============================================================================
-- Owner pc1: INSERT, UPDATE expires_on, hard DELETE blocked, unique constraint
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000f1',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

insert into public.provider_certifications (provider_id, certification_id, issued_on, expires_on, reference)
  values (
    '00000000-0000-0000-0000-0000000000f1',
    (select id from public.certifications where slug = 'dbs-enhanced'),
    '2024-01-01',
    '2026-01-01',
    'DBS-001'
  );

select is(
  (select count(*)::int from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f1' and deleted_at is null),
  1,
  'owner can INSERT provider_certifications row with minimal fields'
);

update public.provider_certifications
  set expires_on = '2027-06-30'
  where provider_id = '00000000-0000-0000-0000-0000000000f1'
    and certification_id = (select id from public.certifications where slug = 'dbs-enhanced');

select is(
  (select expires_on from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f1'
      and certification_id = (select id from public.certifications where slug = 'dbs-enhanced')),
  '2027-06-30'::date,
  'owner can UPDATE expires_on on own row'
);

-- Hard DELETE is blocked by the guard trigger on the non-admin path.
select throws_ok(
  $$ delete from public.provider_certifications
     where provider_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'provider_certifications are soft-deleted; set deleted_at instead',
  'owner hard DELETE is rejected by tg_provider_certifications_block_delete'
);

-- A second active INSERT of the same (provider, cert type) violates the
-- partial unique index.
select throws_ok(
  $$ insert into public.provider_certifications (provider_id, certification_id)
     values (
       '00000000-0000-0000-0000-0000000000f1',
       (select id from public.certifications where slug = 'dbs-enhanced')
     ) $$,
  '23505',
  null,
  'partial unique index blocks a second active row for the same (provider, cert type)'
);

-- Soft-delete the current row; owner still sees it because owner_read has no
-- deleted_at filter (per brief).
update public.provider_certifications
  set deleted_at = now()
  where provider_id = '00000000-0000-0000-0000-0000000000f1'
    and certification_id = (select id from public.certifications where slug = 'dbs-enhanced');

select is(
  (select count(*)::int from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f1'
      and certification_id = (select id from public.certifications where slug = 'dbs-enhanced')),
  1,
  'owner still sees soft-deleted row via owner_read (no deleted_at filter)'
);

-- rls#8: owner cannot un-soft-delete (clear deleted_at) via the guard trigger.
select throws_ok(
  $$ update public.provider_certifications set deleted_at = null
     where provider_id = '00000000-0000-0000-0000-0000000000f1'
       and certification_id = (select id from public.certifications where slug = 'dbs-enhanced') $$,
  '42501',
  'undelete is admin-only',
  'owner cannot clear deleted_at (undelete) on provider_certifications'
);

-- After soft-delete, re-inserting the same (provider, cert type) succeeds
-- because the partial unique index only covers deleted_at IS NULL rows.
insert into public.provider_certifications (provider_id, certification_id, issued_on)
  values (
    '00000000-0000-0000-0000-0000000000f1',
    (select id from public.certifications where slug = 'dbs-enhanced'),
    '2025-02-01'
  );

select is(
  (select count(*)::int from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f1'
      and certification_id = (select id from public.certifications where slug = 'dbs-enhanced')
      and deleted_at is null),
  1,
  'partial unique index allows re-INSERT after soft-delete'
);

reset role;

-- Seed a row on the verified provider pc2 so anon has something to read.
insert into public.provider_certifications (provider_id, certification_id, issued_on, reference)
  values (
    '00000000-0000-0000-0000-0000000000f2',
    (select id from public.certifications where slug = 'first-aid-at-work'),
    '2025-03-01',
    'FAW-002'
  );

-- =============================================================================
-- Anonymous browsing: column grant narrowing + verified gate
-- =============================================================================
set local role anon;
select set_config('request.jwt.claims', '', true);

-- anon has NO column grant on `reference` -> selecting that column throws.
select throws_ok(
  $$ select reference from public.provider_certifications limit 1 $$,
  '42501',
  null,
  'anon cannot SELECT the reference column (not in anon column grant)'
);

-- Granted columns on a verified provider are visible.
select is(
  (select count(*)::int from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f2'),
  1,
  'anon CAN SELECT granted columns on a verified provider row'
);

-- Unverified provider rows are hidden entirely (draft not leaked).
select is(
  (select count(*)::int from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'anon CANNOT SELECT any rows for an unverified provider'
);

reset role;

-- =============================================================================
-- Admin: full write, including hard DELETE which bypasses the guard trigger
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000fd',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

update public.provider_certifications
  set reference = 'ADMIN-EDIT'
  where provider_id = '00000000-0000-0000-0000-0000000000f2';

select is(
  (select reference from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f2'),
  'ADMIN-EDIT',
  'admin can UPDATE arbitrary columns on any row'
);

delete from public.provider_certifications
  where provider_id = '00000000-0000-0000-0000-0000000000f2';

select is(
  (select count(*)::int from public.provider_certifications
    where provider_id = '00000000-0000-0000-0000-0000000000f2'),
  0,
  'admin hard DELETE bypasses the guard trigger'
);

reset role;

select * from finish();
rollback;
