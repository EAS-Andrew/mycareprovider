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
--
-- Post-0009: handle_new_auth_user only honours raw_user_meta_data.role when
-- raw_app_meta_data.invited_by is set (the admin-invite path). For the seed
-- admin / provider / family_member users, set invited_by='seed' so the
-- trigger creates the profile row with the requested role directly - no
-- follow-up privileged UPDATE needed.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change_token_current, email_change,
  phone_change_token, phone_change, reauthentication_token
)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"admin","display_name":"Seed Admin"}'::jsonb,
   '{"invited_by":"seed"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'provider-a@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"provider","display_name":"Alex Provider"}'::jsonb,
   '{"invited_by":"seed"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'provider-b@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"provider","display_name":"Blair Provider"}'::jsonb,
   '{"invited_by":"seed"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'company@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"provider_company","display_name":"Synthetic Care Co"}'::jsonb,
   '{"invited_by":"seed"}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'receiver-a@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"receiver","display_name":"Casey Receiver"}'::jsonb,
   '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'receiver-b@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"receiver","display_name":"Drew Receiver"}'::jsonb,
   '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'family@example.test', crypt('devpassword', gen_salt('bf')),
   now(), '{"role":"family_member","display_name":"Ellis Family"}'::jsonb,
   '{"invited_by":"seed"}'::jsonb, now(), now(),
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

-- -----------------------------------------------------------------------------
-- 3. Demo provider directory rows.
--
-- Alex and Blair are two verified providers in London and Manchester so the
-- C7a public directory (/providers) has something to render straight after a
-- `supabase db reset`. All inserts are idempotent.
--
-- verified_at is forced via the admin-capable seed path (seed.sql runs as the
-- superuser bootstrap role, not an authenticated app user, so the admin-only
-- guard trigger on provider_profiles.verified_at does not apply).
-- -----------------------------------------------------------------------------
insert into public.provider_profiles (
  id, headline, bio,
  date_of_birth, phone,
  address_line1, city, postcode, country,
  years_experience, hourly_rate_pence, gender,
  service_postcode, latitude, longitude, service_radius_km, geocoded_at,
  verified_at
) values
  (
    '00000000-0000-0000-0000-0000000000a2',
    'Dementia and personal care specialist - London',
    'Fifteen years supporting older adults across central and south London, with a focus on dementia care, medication support, and dignified personal care. Enhanced DBS, manual handling trained, and comfortable working alongside district nurses and family members.',
    '1985-04-12', '+447700900001',
    '1 Example Street', 'London', 'SW1A 1AA', 'GB',
    15, 2800, 'female',
    'SW1A 1AA', 51.5014, -0.1419, 30, now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-0000000000a3',
    'Live-in and companionship care - Greater Manchester',
    'Seven years of live-in and visiting care across Greater Manchester. I specialise in companionship, domestic support, and helping people stay independent at home. Trained in manual handling and mental health first aid.',
    '1990-09-22', '+447700900002',
    '2 Example Road', 'Manchester', 'M1 1AE', 'GB',
    7, 2200, 'male',
    'M1 1AE', 53.4794, -2.2453, 25, now(),
    now()
  )
on conflict (id) do update set
  headline          = excluded.headline,
  bio               = excluded.bio,
  city              = excluded.city,
  postcode          = excluded.postcode,
  years_experience  = excluded.years_experience,
  hourly_rate_pence = excluded.hourly_rate_pence,
  gender            = excluded.gender,
  service_postcode  = excluded.service_postcode,
  latitude          = excluded.latitude,
  longitude         = excluded.longitude,
  service_radius_km = excluded.service_radius_km,
  geocoded_at       = excluded.geocoded_at,
  verified_at       = excluded.verified_at;

-- Alex services: personal-care, dementia-care, medication-support
insert into public.provider_services (provider_id, service_category_id)
select '00000000-0000-0000-0000-0000000000a2', sc.id
from public.service_categories sc
where sc.slug in ('personal-care', 'dementia-care', 'medication-support')
on conflict do nothing;

-- Blair services: companionship, domestic-support, live-in-care
insert into public.provider_services (provider_id, service_category_id)
select '00000000-0000-0000-0000-0000000000a3', sc.id
from public.service_categories sc
where sc.slug in ('companionship', 'domestic-support', 'live-in-care')
on conflict do nothing;

-- Alex capabilities: dementia-care-trained, medication-administration, manual-handling
insert into public.provider_capabilities (provider_id, capability_id)
select '00000000-0000-0000-0000-0000000000a2', c.id
from public.capabilities c
where c.slug in ('dementia-care-trained', 'medication-administration', 'manual-handling')
on conflict do nothing;

-- Blair capabilities: manual-handling, mental-health-first-aid
insert into public.provider_capabilities (provider_id, capability_id)
select '00000000-0000-0000-0000-0000000000a3', c.id
from public.capabilities c
where c.slug in ('manual-handling', 'mental-health-first-aid')
on conflict do nothing;
