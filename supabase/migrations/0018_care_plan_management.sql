-- 0017_care_plan_management.sql
--
-- C10: Care plan management.
--   - care_plans (soft-delete, status state machine)
--   - care_plan_versions (append-only, full snapshot + line items)
--   - care_plan_activities (ordered activities per version)
--   - Real body for app.can_see_care_plan() (replaces the 0001 stub)
--   - Status transition guard trigger on care_plans
--   - Auto-sync trigger: version status changes cascade to care_plans.status
--
-- DESIGN NOTES
-- ------------
-- 1. care_plan_versions is append-only: no UPDATE or DELETE policies for
--    regular users, matching the PID's append-only list. Admin gets full
--    access for operational corrections.
--
-- 2. Visit media consent (story 78) is captured on care_plan_versions at
--    approval time. The boolean, granting user, and timestamp are immutable
--    once set because the version row is append-only. A new version must be
--    approved to change consent.
--
-- 3. line_items is stored as jsonb on the version row rather than a separate
--    table because line items are part of the immutable snapshot. Each element
--    is {description, unit, quantity, unit_price_pence, notes}.
--
-- 4. total_pence is a generated column computed from line_items so it is
--    always consistent and queryable without parsing jsonb.
--
-- 5. app.can_see_care_plan() checks provider, receiver, and care circle
--    membership. It uses the same parameter name (care_plan_id) as the 0001
--    stub so CREATE OR REPLACE does not error on a parameter name mismatch.

-- =============================================================================
-- care_plans
-- =============================================================================
create table if not exists public.care_plans (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.provider_profiles(id) on delete cascade,
  receiver_id  uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  status       text not null default 'draft' check (
    status in ('draft', 'pending_approval', 'active', 'paused', 'completed', 'cancelled')
  ),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists care_plans_provider_idx
  on public.care_plans (provider_id)
  where deleted_at is null;

create index if not exists care_plans_receiver_idx
  on public.care_plans (receiver_id)
  where deleted_at is null;

drop trigger if exists care_plans_set_updated_at on public.care_plans;
create trigger care_plans_set_updated_at
before update on public.care_plans
for each row execute function app.tg_set_updated_at();

-- Status transition guard: only allows valid transitions.
create or replace function public.tg_care_plans_guard_status()
returns trigger
language plpgsql
as $$
declare
  allowed boolean;
begin
  -- Admin bypasses the state machine for operational corrections.
  if app.current_role() = 'admin'::public.app_role then
    return new;
  end if;

  -- Soft-delete / undelete guards
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'undelete is admin-only'
      using errcode = '42501';
  end if;

  -- If status did not change, allow the update (title edits etc.)
  if new.status = old.status then
    return new;
  end if;

  -- Valid transitions:
  --   draft -> pending_approval
  --   pending_approval -> active (on approval)
  --   pending_approval -> draft (on rejection, back to draft)
  --   active -> paused
  --   paused -> active
  --   active -> completed
  --   any -> cancelled
  allowed := false;

  if new.status = 'cancelled' then
    allowed := true;
  elsif old.status = 'draft' and new.status = 'pending_approval' then
    allowed := true;
  elsif old.status = 'pending_approval' and new.status = 'active' then
    allowed := true;
  elsif old.status = 'pending_approval' and new.status = 'draft' then
    allowed := true;
  elsif old.status = 'active' and new.status = 'paused' then
    allowed := true;
  elsif old.status = 'paused' and new.status = 'active' then
    allowed := true;
  elsif old.status = 'active' and new.status = 'completed' then
    allowed := true;
  end if;

  if not allowed then
    raise exception 'invalid care plan status transition: % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists care_plans_guard_status on public.care_plans;
create trigger care_plans_guard_status
before update on public.care_plans
for each row execute function public.tg_care_plans_guard_status();

-- =============================================================================
-- care_plan_versions (append-only)
-- =============================================================================

-- Helper to compute total from line_items jsonb array.
create or replace function public.care_plan_line_items_total(items jsonb)
returns int
language sql
immutable
as $$
  select coalesce(
    (select sum(
      (elem ->> 'quantity')::numeric * (elem ->> 'unit_price_pence')::numeric
    )::int
    from jsonb_array_elements(items) as elem),
    0
  );
$$;

create table if not exists public.care_plan_versions (
  id                   uuid primary key default gen_random_uuid(),
  care_plan_id         uuid not null references public.care_plans(id) on delete cascade,
  version_number       int not null,
  snapshot             jsonb not null default '{}'::jsonb,
  line_items           jsonb not null default '[]'::jsonb,
  total_pence          int not null generated always as (
    public.care_plan_line_items_total(line_items)
  ) stored,
  visit_media_consent  boolean not null default false,
  consent_granted_by   uuid references public.profiles(id),
  consent_granted_at   timestamptz,
  created_by           uuid not null references public.profiles(id),
  approved_by          uuid references public.profiles(id),
  approved_at          timestamptz,
  rejection_reason     text,
  status               text not null default 'draft' check (
    status in ('draft', 'submitted', 'approved', 'rejected')
  ),
  notes                text,
  created_at           timestamptz not null default now(),
  constraint care_plan_versions_unique_number unique (care_plan_id, version_number)
);

create index if not exists care_plan_versions_plan_version_idx
  on public.care_plan_versions (care_plan_id, version_number desc);

-- =============================================================================
-- care_plan_activities
-- =============================================================================
create table if not exists public.care_plan_activities (
  id                    uuid primary key default gen_random_uuid(),
  care_plan_version_id  uuid not null references public.care_plan_versions(id) on delete cascade,
  title                 text not null,
  description           text,
  frequency             text not null check (
    frequency in ('daily', 'weekly', 'fortnightly', 'monthly', 'as_needed')
  ),
  duration_minutes      int check (duration_minutes > 0),
  sort_order            int not null default 0,
  created_at            timestamptz not null default now()
);

create index if not exists care_plan_activities_version_sort_idx
  on public.care_plan_activities (care_plan_version_id, sort_order);

-- =============================================================================
-- app.can_see_care_plan() real body (replaces the 0001 stub)
-- Keeps the original parameter name "care_plan_id" from the 0001 stub.
-- =============================================================================
create or replace function app.can_see_care_plan(care_plan_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.care_plans cp
    where cp.id = can_see_care_plan.care_plan_id
      and cp.deleted_at is null
      and (
        -- The provider who created the plan
        cp.provider_id = app.current_profile_id()
        -- The receiver the plan is for
        or cp.receiver_id = app.current_profile_id()
        -- A care circle member of the receiver
        or exists (
          select 1
          from public.care_circles cc
          where cc.receiver_id = cp.receiver_id
            and cc.deleted_at is null
            and app.is_care_circle_member(cc.id)
        )
      )
  );
$$;

-- =============================================================================
-- RLS: care_plans
-- =============================================================================
alter table public.care_plans enable row level security;

revoke all on public.care_plans from anon, authenticated;
grant select, insert, update, delete on public.care_plans to authenticated;

-- SELECT: participants via app.can_see_care_plan
drop policy if exists care_plans_participant_read on public.care_plans;
create policy care_plans_participant_read
  on public.care_plans
  for select
  to authenticated
  using (deleted_at is null and app.can_see_care_plan(id));

-- INSERT: authenticated providers can create care plans
drop policy if exists care_plans_provider_insert on public.care_plans;
create policy care_plans_provider_insert
  on public.care_plans
  for insert
  to authenticated
  with check (
    provider_id = app.current_profile_id()
    and deleted_at is null
    and app.current_role() in ('provider'::public.app_role, 'provider_company'::public.app_role)
  );

-- UPDATE: participants can update (status changes guarded by trigger)
drop policy if exists care_plans_participant_update on public.care_plans;
create policy care_plans_participant_update
  on public.care_plans
  for update
  to authenticated
  using (deleted_at is null and app.can_see_care_plan(id))
  with check (app.can_see_care_plan(id));

-- Admin full access
drop policy if exists care_plans_admin on public.care_plans;
create policy care_plans_admin
  on public.care_plans
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- RLS: care_plan_versions (append-only: SELECT + INSERT only, no UPDATE/DELETE)
-- =============================================================================
alter table public.care_plan_versions enable row level security;

revoke all on public.care_plan_versions from anon, authenticated;
grant select, insert on public.care_plan_versions to authenticated;

-- SELECT: via parent care plan visibility
drop policy if exists care_plan_versions_read on public.care_plan_versions;
create policy care_plan_versions_read
  on public.care_plan_versions
  for select
  to authenticated
  using (app.can_see_care_plan(care_plan_id));

-- INSERT: providers can create new versions
drop policy if exists care_plan_versions_provider_insert on public.care_plan_versions;
create policy care_plan_versions_provider_insert
  on public.care_plan_versions
  for insert
  to authenticated
  with check (
    created_by = app.current_profile_id()
    and app.can_see_care_plan(care_plan_id)
  );

-- Admin full access (needs UPDATE grant for admin operations like approval)
grant update, delete on public.care_plan_versions to authenticated;

drop policy if exists care_plan_versions_admin on public.care_plan_versions;
create policy care_plan_versions_admin
  on public.care_plan_versions
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- RLS: care_plan_activities
-- =============================================================================
alter table public.care_plan_activities enable row level security;

revoke all on public.care_plan_activities from anon, authenticated;
grant select, insert on public.care_plan_activities to authenticated;

-- SELECT: via parent version's care plan visibility
drop policy if exists care_plan_activities_read on public.care_plan_activities;
create policy care_plan_activities_read
  on public.care_plan_activities
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.care_plan_versions cpv
      where cpv.id = care_plan_activities.care_plan_version_id
        and app.can_see_care_plan(cpv.care_plan_id)
    )
  );

-- INSERT: authenticated users who can see the parent care plan
drop policy if exists care_plan_activities_insert on public.care_plan_activities;
create policy care_plan_activities_insert
  on public.care_plan_activities
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.care_plan_versions cpv
      where cpv.id = care_plan_activities.care_plan_version_id
        and app.can_see_care_plan(cpv.care_plan_id)
    )
  );

-- Admin full access
grant update, delete on public.care_plan_activities to authenticated;

drop policy if exists care_plan_activities_admin on public.care_plan_activities;
create policy care_plan_activities_admin
  on public.care_plan_activities
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);
