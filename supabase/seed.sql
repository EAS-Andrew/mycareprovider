-- supabase/seed.sql
--
-- Synthetic local-dev seed. Safe to run multiple times (all inserts are
-- idempotent). Executed automatically by `supabase db reset`.
--
-- The super admin email is read from the `app.super_admin_email` custom
-- setting so that it can be parameterised per environment without editing
-- this file. To set it locally:
--
--   psql "$DATABASE_URL" -c "alter database postgres set app.super_admin_email = 'admin@example.test'"
--
-- Or, in CI / per-PR Supabase branches, export SUPER_ADMIN_EMAIL in the env
-- and let the `supabase db reset` hook surface it. If the setting is unset
-- this file falls back to 'admin@example.test' so local dev just works.
--
-- PII rule: every seed email uses the reserved example.test TLD - there is
-- no risk of accidentally emailing a real mailbox, even if the local stack
-- is misconfigured to talk to a real SMTP server.

-- -----------------------------------------------------------------------------
-- 1. Synthetic auth.users rows. The on_auth_user_created trigger defined in
--    migration 0001 will auto-create matching public.profiles rows using the
--    role from raw_user_meta_data.
--
-- Every seed user is given the bcrypt hash of the literal dev password
-- "devpassword" so local sign-in works out of the box (no dashboard poking,
-- no magic-link detour through Mailpit). This is strictly a local-dev
-- convenience: the seed only runs on the local stack and per-PR Supabase
-- branches, never in production, and the example.test TLD makes it obvious
-- these are not real accounts.
-- -----------------------------------------------------------------------------
-- GoTrue cannot scan NULL into the token string columns (confirmation_token,
-- recovery_token, email_change_*, phone_change, reauthentication_token), so
-- every token column must be set to '' explicitly. Skipping any of these
-- produces "Database error querying schema" at sign-in time.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change_token_current, email_change,
  phone_change_token, phone_change, reauthentication_token
)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"admin","display_name":"Seed Admin"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'provider-a@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"provider","display_name":"Alex Provider"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'provider-b@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"provider","display_name":"Blair Provider"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'company@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"provider_company","display_name":"Synthetic Care Co"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'receiver-a@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"receiver","display_name":"Casey Receiver"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'receiver-b@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"receiver","display_name":"Drew Receiver"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'family@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"family_member","display_name":"Ellis Family"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Promote the seed admin. ensure_super_admin is idempotent and a no-op if
--    any admin already exists.
-- -----------------------------------------------------------------------------
select public.ensure_super_admin(
  coalesce(
    current_setting('app.super_admin_email', true),
    'admin@example.test'
  )
);
