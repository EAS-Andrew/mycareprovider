-- 0003_seed_super_admin.sql
--
-- This migration is intentionally a no-op at DDL level. Migrations cannot
-- read environment variables, and the super-admin email is different in
-- every environment (local laptop, per-PR Supabase branch, staging, prod),
-- so the actual seeding lives in supabase/seed.sql which reads the setting
-- `app.super_admin_email` (populated from SUPER_ADMIN_EMAIL) at apply time.
--
-- All this migration does is declare the idempotent promotion helper that
-- seed.sql calls. Keeping the helper in a migration (not just in seed.sql)
-- means production can also call it from a one-off SQL console session
-- during an initial bootstrap without running the full synthetic seed.
--
-- Usage from seed.sql:
--   select public.ensure_super_admin(current_setting('app.super_admin_email', true));
--
-- Usage from a hosted environment (no seed.sql):
--   alter database postgres set app.super_admin_email = 'real@org.example';
--   select public.ensure_super_admin('real@org.example');

create or replace function public.ensure_super_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_email is null or length(trim(p_email)) = 0 then
    return;
  end if;

  -- Idempotent: if any non-deleted admin already exists, do nothing.
  if exists (
    select 1
    from public.profiles
    where role = 'admin'::public.app_role
      and deleted_at is null
  ) then
    return;
  end if;

  -- Promote the matching auth.users row if present. The actual account is
  -- created out-of-band (sign-up flow or supabase dashboard invite); this
  -- function only upgrades the role.
  select id
    into v_user_id
  from auth.users
  where auth.users.email = p_email;

  if v_user_id is null then
    return;
  end if;

  insert into public.profiles (id, role, email)
  values (v_user_id, 'admin'::public.app_role, p_email)
  on conflict (id) do update
    set role       = 'admin'::public.app_role,
        deleted_at = null;
end;
$$;

comment on function public.ensure_super_admin(text) is
  'Idempotent promotion of a pre-existing auth user to admin. Called by '
  'supabase/seed.sql with current_setting(''app.super_admin_email'', true).';
