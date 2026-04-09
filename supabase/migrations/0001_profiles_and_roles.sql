-- 0001_profiles_and_roles.sql
--
-- Ships the C2 auth foundation:
--   - app_role enum
--   - profiles table (soft-delete, auto-provisioned from auth.users)
--   - custom_access_token_hook (writes role into event.claims.app_role)
--   - app-schema RLS helper functions (current_profile_id, current_role,
--     plus stubs for circle / company / verification / care-plan helpers).
--     NOTE: Supabase reserves the `auth` schema for its auth service and
--     forbids CREATE from the postgres role, so helpers live in a dedicated
--     `app` schema that we own. Policies call `app.current_role()` etc.
--   - profiles RLS policies (self-read / self-update, admin full, anon
--     directory read of provider rows, columns narrowed via column grants)
--
-- OPERATOR NOTE (one-time per environment):
-- Supabase Dashboard -> Authentication -> Hooks -> Custom Access Token must be
-- pointed at public.custom_access_token_hook. Without that setting the
-- app_role claim will NOT appear on issued JWTs and app.current_role() will
-- silently fall back to a profiles join (correct result, extra query per
-- request). The hook is also declared in supabase/config.toml for local dev.

-- =============================================================================
-- Extensions & helper schema
-- =============================================================================
create extension if not exists pgcrypto;

-- Dedicated schema for RLS helpers and other app-owned plumbing. We cannot
-- extend the `auth` schema (Supabase-reserved, postgres lacks CREATE there),
-- so `app` is the PID-compliant substitute. Every RLS policy is still a
-- one-liner calling a helper in this schema.
create schema if not exists app;
grant usage on schema app to anon, authenticated;

-- =============================================================================
-- Enum
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'admin',
      'provider',
      'provider_company',
      'receiver',
      'family_member'
    );
  end if;
end
$$;

-- =============================================================================
-- profiles table
-- =============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         public.app_role not null default 'receiver',
  display_name text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists profiles_role_live_idx
  on public.profiles (role)
  where deleted_at is null;

-- updated_at auto-maintenance
create or replace function public.tg_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.tg_profiles_set_updated_at();

-- =============================================================================
-- Auto-provision a profiles row whenever auth.users gets a new row.
-- raw_user_meta_data.role picks the role; unknown values fall back to receiver.
-- =============================================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  begin
    v_role := coalesce(
      (new.raw_user_meta_data ->> 'role')::public.app_role,
      'receiver'::public.app_role
    );
  exception
    when invalid_text_representation then
      v_role := 'receiver';
  end;

  insert into public.profiles (id, role, display_name, email)
  values (
    new.id,
    v_role,
    new.raw_user_meta_data ->> 'display_name',
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- =============================================================================
-- Custom Access Token hook.
-- Supabase Auth calls this function with the issued event, we enrich it with
-- the current profile role, and return it. See file header for the dashboard
-- setting that must point at this function.
-- =============================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  v_role public.app_role;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  select role
    into v_role
  from public.profiles
  where id = (event ->> 'user_id')::uuid
    and deleted_at is null;

  if v_role is not null then
    claims := jsonb_set(claims, '{app_role}', to_jsonb(v_role::text), true);
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- =============================================================================
-- RLS helper functions (app schema). Policies are one-liners that call these.
-- =============================================================================

create or replace function app.current_profile_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- Reads the app_role claim from the JWT; falls back to a profiles lookup so
-- policies still work in the window between sign-up and the first token that
-- carries the claim. Fallback path costs one indexed lookup.
create or replace function app.current_role()
returns public.app_role
language plpgsql
stable
as $$
declare
  v_claim text;
  v_role  public.app_role;
begin
  v_claim := nullif(current_setting('request.jwt.claims', true), '');
  if v_claim is not null then
    begin
      v_role := (v_claim::jsonb ->> 'app_role')::public.app_role;
      if v_role is not null then
        return v_role;
      end if;
    exception
      when others then
        -- fall through to the profiles lookup below
        null;
    end;
  end if;

  select role
    into v_role
  from public.profiles
  where id = auth.uid()
    and deleted_at is null;

  return v_role;
end;
$$;

-- Stubs. Real bodies ship with later components (C4 circles, C3b companies,
-- C3a verification, C10 care plans). They return false so that, in the
-- meantime, any policy that calls them denies access by default - which is
-- the safe direction to fail in.
create or replace function app.is_care_circle_member(circle_id uuid)
returns boolean language sql stable as $$ select false; $$;

create or replace function app.is_company_member(company_id uuid)
returns boolean language sql stable as $$ select false; $$;

create or replace function app.is_provider_verified()
returns boolean language sql stable as $$ select false; $$;

create or replace function app.can_see_care_plan(care_plan_id uuid)
returns boolean language sql stable as $$ select false; $$;

grant execute on function
  app.current_profile_id(),
  app.current_role(),
  app.is_care_circle_member(uuid),
  app.is_company_member(uuid),
  app.is_provider_verified(),
  app.can_see_care_plan(uuid)
to anon, authenticated;

-- =============================================================================
-- Guard trigger: prevent non-admins from changing their own role or undoing
-- a soft delete via UPDATE (RLS would otherwise let a receiver write those
-- columns to their own row because USING matches).
-- =============================================================================
create or replace function public.tg_profiles_guard_role()
returns trigger
language plpgsql
as $$
begin
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

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
before update on public.profiles
for each row execute function public.tg_profiles_guard_role();

-- =============================================================================
-- Grants (column-narrowed for anon) and RLS policies.
--
-- Design note: the public directory surface (story 8) is expressed via a
-- column-level grant on (id, role, display_name) for anon combined with a
-- narrow SELECT policy. This was picked over a `public_profiles` view so
-- there's a single source of truth for which rows are public, and so that
-- Supabase-generated types continue to match the base table. RLS is not
-- forced on the table because the auto-provision trigger runs security
-- definer and must be able to insert via the owner path.
-- =============================================================================
alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select (id, role, display_name) on public.profiles to anon;
grant select, insert, update, delete on public.profiles to authenticated;

drop policy if exists profiles_public_directory on public.profiles;
create policy profiles_public_directory
  on public.profiles
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and role in ('provider'::public.app_role, 'provider_company'::public.app_role)
  );

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select
  on public.profiles
  for select
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null);

drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select
  on public.profiles
  for select
  to authenticated
  using (app.current_role() = 'admin'::public.app_role);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles
  for update
  to authenticated
  using (id = app.current_profile_id() and deleted_at is null)
  with check (id = app.current_profile_id());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update
  on public.profiles
  for update
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert
  on public.profiles
  for insert
  to authenticated
  with check (app.current_role() = 'admin'::public.app_role);

drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete
  on public.profiles
  for delete
  to authenticated
  using (app.current_role() = 'admin'::public.app_role);
