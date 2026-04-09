-- pgTAP tests for public.contact_thread_posts: party-only insert, rate
-- limiting via app.bump_rate_limit, append-only guarantee.

begin;

create extension if not exists pgtap;

select plan(7);

-- Fixtures. Non-receiver fixtures set raw_app_meta_data.invited_by so
-- post-0009 handle_new_auth_user honours the requested role.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000c861', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tp-rec@t.test',
   '{"role":"receiver","display_name":"TpRec"}'::jsonb,
   '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c862', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tp-prov@t.test',
   '{"role":"provider","display_name":"TpProv"}'::jsonb,
   '{"invited_by":"test-setup"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-00000000c863', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tp-third@t.test',
   '{"role":"receiver","display_name":"TpThird"}'::jsonb,
   '{}'::jsonb, now(), now());

insert into public.provider_profiles (id, headline, verified_at)
values ('00000000-0000-0000-0000-00000000c862', 'Prov', now());

-- Two accepted contact requests so we have two bridging threads and we can
-- verify the rate-limit scope is per-thread, not per-account. Disable user
-- triggers during the fixture insert so (a) the new contact_requests
-- rate-limit trigger does not require a JWT claim and (b) the AFTER INSERT
-- open-thread trigger does not pre-allocate threads we want to create with
-- deterministic IDs below.
set local session_replication_role = replica;

insert into public.contact_requests (id, receiver_id, provider_id, subject, body, status)
values
  ('00000000-0000-0000-0000-00000000cc61', '00000000-0000-0000-0000-00000000c861',
   '00000000-0000-0000-0000-00000000c862', 'Subject1', 'body body body body body', 'accepted'),
  ('00000000-0000-0000-0000-00000000cc62', '00000000-0000-0000-0000-00000000c861',
   '00000000-0000-0000-0000-00000000c862', 'Subject2', 'body body body body body', 'accepted');

insert into public.contact_threads (id, contact_request_id)
values
  ('00000000-0000-0000-0000-00000000cd61', '00000000-0000-0000-0000-00000000cc61'),
  ('00000000-0000-0000-0000-00000000cd62', '00000000-0000-0000-0000-00000000cc62');

set local session_replication_role = origin;

-- =============================================================================
-- Receiver posts
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c861',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

insert into public.contact_thread_posts (thread_id, author_id, body)
values ('00000000-0000-0000-0000-00000000cd61', '00000000-0000-0000-0000-00000000c861', 'Hi!');

select is(
  (select count(*)::int from public.contact_thread_posts where thread_id = '00000000-0000-0000-0000-00000000cd61'),
  1,
  'receiver can post to the thread'
);

reset role;

-- =============================================================================
-- Provider posts
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c862',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

insert into public.contact_thread_posts (thread_id, author_id, body)
values ('00000000-0000-0000-0000-00000000cd61', '00000000-0000-0000-0000-00000000c862', 'Hello!');

select is(
  (select count(*)::int from public.contact_thread_posts where thread_id = '00000000-0000-0000-0000-00000000cd61'),
  2,
  'provider can post to the thread'
);

reset role;

-- =============================================================================
-- Third party cannot post
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c863',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select throws_ok(
  $$ insert into public.contact_thread_posts (thread_id, author_id, body)
     values ('00000000-0000-0000-0000-00000000cd61',
             '00000000-0000-0000-0000-00000000c863',
             'Sneaky post') $$,
  '42501',
  null,
  'unrelated third party cannot post to the thread'
);

reset role;

-- =============================================================================
-- Post updates are denied (append-only)
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c861',
    'role',     'authenticated',
    'app_role', 'receiver'
  )::text,
  true
);

select throws_ok(
  $$ update public.contact_thread_posts set body = 'edited' where thread_id = '00000000-0000-0000-0000-00000000cd61' $$,
  '42501',
  null,
  'posts cannot be updated (no UPDATE grant)'
);

reset role;

-- =============================================================================
-- rls#10 / contact C-6: rate limit scope is PER THREAD, so a full bucket on
-- thread 1 must not block posts on thread 2.
-- =============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',      '00000000-0000-0000-0000-00000000c862',
    'role',     'authenticated',
    'app_role', 'provider'
  )::text,
  true
);

-- The provider already posted once to cd61 (counted as bump #1 on that
-- thread's bucket). Insert 29 more to hit the 30/minute cap on cd61, then
-- the 31st on cd61 must throw.
do $$
begin
  for i in 1..29 loop
    insert into public.contact_thread_posts (thread_id, author_id, body)
    values ('00000000-0000-0000-0000-00000000cd61',
            '00000000-0000-0000-0000-00000000c862',
            'burst ' || i::text);
  end loop;
end $$;

select is(
  (select count(*)::int from public.contact_thread_posts
    where thread_id = '00000000-0000-0000-0000-00000000cd61'
      and author_id = '00000000-0000-0000-0000-00000000c862'),
  30,
  '30 provider posts fit under the per-(author,thread) rate limit on thread 1'
);

select throws_ok(
  $$ insert into public.contact_thread_posts (thread_id, author_id, body)
     values ('00000000-0000-0000-0000-00000000cd61',
             '00000000-0000-0000-0000-00000000c862',
             'over the limit') $$,
  'P0001',
  null,
  '31st post on thread 1 in the same minute raises rate_limited (P0001)'
);

-- Scope proof: the provider can still post to thread 2 even though the
-- thread 1 bucket is saturated, because the rate-limit scope is keyed on
-- thread_id.
insert into public.contact_thread_posts (thread_id, author_id, body)
values ('00000000-0000-0000-0000-00000000cd62',
        '00000000-0000-0000-0000-00000000c862',
        'thread-2 post survives thread-1 saturation');

select is(
  (select count(*)::int from public.contact_thread_posts where thread_id = '00000000-0000-0000-0000-00000000cd62'),
  1,
  'thread 2 bucket is independent of thread 1 (per-thread scope)'
);

reset role;

select * from finish();
rollback;
