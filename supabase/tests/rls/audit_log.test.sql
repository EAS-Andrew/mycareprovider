-- pgTAP tests for public.audit_log RLS and the hash-chain trigger.
--
-- Verifies: authenticated insert succeeds, rows chain correctly via
-- prev_hash/row_hash, actor impersonation is blocked, actor can read own
-- entries, admin can read everything, and update/delete are silently
-- denied (no policy -> zero rows affected, not a throw).

begin;

create extension if not exists pgtap;

select plan(10);

-- -----------------------------------------------------------------------------
-- Fixture users
-- -----------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'actor@t.test',
   '{"role":"provider","display_name":"Actor"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-reader@t.test',
   '{"role":"admin","display_name":"Admin Reader"}'::jsonb, now(), now());

-- =============================================================================
-- Authenticated actor inserts
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

insert into public.audit_log (actor_id, actor_role, action, subject_table, subject_id, before, after)
values (
  '00000000-0000-0000-0000-0000000000b1',
  'provider',
  'profile.create',
  'profiles',
  '00000000-0000-0000-0000-0000000000b1',
  null,
  '{"role":"provider"}'::jsonb
);

insert into public.audit_log (actor_id, actor_role, action, subject_table, subject_id, before, after)
values (
  '00000000-0000-0000-0000-0000000000b1',
  'provider',
  'profile.update',
  'profiles',
  '00000000-0000-0000-0000-0000000000b1',
  '{"display_name":null}'::jsonb,
  '{"display_name":"Actor"}'::jsonb
);

select is(
  (select count(*)::int from public.audit_log where actor_id = '00000000-0000-0000-0000-0000000000b1'),
  2,
  'authenticated actor can insert and read own audit rows'
);

-- row_hash is always populated
select isnt(
  (select row_hash from public.audit_log order by id desc limit 1),
  null::bytea,
  'row_hash is populated on every insert'
);

-- Hash chain: newer row's prev_hash == older row's row_hash
select is(
  (select prev_hash from public.audit_log order by id desc limit 1),
  (select row_hash from public.audit_log order by id asc  limit 1),
  'prev_hash on row N equals row_hash on row N-1 (chain intact)'
);

-- Chain root: the first row has a null prev_hash
select is(
  (select prev_hash from public.audit_log order by id asc limit 1),
  null::bytea,
  'first row in chain has null prev_hash'
);

-- Impersonating another actor_id is blocked by WITH CHECK
select throws_ok(
  $$ insert into public.audit_log (actor_id, action, subject_table)
     values ('00000000-0000-0000-0000-0000000000cc', 'forged', 'profiles') $$,
  '42501',
  null,
  'authenticated user cannot insert audit row with another actor_id'
);

-- UPDATE: RLS has no update policy, so 0 rows are affected (no throw).
update public.audit_log
  set action = 'tampered'
  where actor_id = '00000000-0000-0000-0000-0000000000b1';

select is(
  (select count(*)::int from public.audit_log where action = 'tampered'),
  0,
  'update is silently denied (no policy -> zero rows affected)'
);

-- DELETE: same treatment.
delete from public.audit_log where actor_id = '00000000-0000-0000-0000-0000000000b1';

select is(
  (select count(*)::int from public.audit_log where actor_id = '00000000-0000-0000-0000-0000000000b1'),
  2,
  'delete is silently denied (no policy -> rows remain)'
);

reset role;

-- =============================================================================
-- Admin reads everything
-- =============================================================================
-- Promote the admin fixture user via owner path (trigger handled this already
-- since raw_user_meta_data.role = 'admin').
select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  'admin',
  'admin fixture is marked admin in profiles'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-0000000000b2',
    'role',     'authenticated',
    'app_role', 'admin'
  )::text,
  true
);

select ok(
  (select count(*) from public.audit_log) >= 2,
  'admin can read all audit rows'
);

-- Admin also cannot update or delete (no policy exists for those verbs at all)
update public.audit_log set action = 'tampered-by-admin';
select is(
  (select count(*)::int from public.audit_log where action = 'tampered-by-admin'),
  0,
  'even admin cannot update audit rows'
);

reset role;

select * from finish();
rollback;
