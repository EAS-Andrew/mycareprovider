-- 0019_fix_provider_signup_role.sql
--
-- Fix: tg_profiles_guard_role blocks role changes from the service_role
-- client (used by signUpProvider and signUpCompany to set the correct role
-- after sign-up). The guard calls app.current_role() which returns null for
-- service_role (no auth.uid()), so the role change is rejected. This
-- matches the early-return pattern already used by tg_documents_guard in
-- migration 0009.

create or replace function public.tg_profiles_guard_role()
returns trigger
language plpgsql
as $$
begin
  -- Service-role client bypasses the guard (used by server-side sign-up
  -- actions that need to set the profile role post-creation).
  if current_user = 'service_role' then
    return new;
  end if;

  if app.current_role() is distinct from 'admin'::public.app_role then
    if new.role is distinct from old.role then
      raise exception 'role changes are admin-only'
        using errcode = '42501';
    end if;
    if old.deleted_at is not null and new.deleted_at is null then
      raise exception 'undelete is admin-only'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
