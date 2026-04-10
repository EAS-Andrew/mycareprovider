-- 0015_safeguarding.sql
--
-- C25: Safeguarding escalation (W1).
--
-- Two append-only tables for regulated safeguarding reports and their event
-- timeline. These are EXEMPT from C24 erasure - safeguarding records are
-- never deleted. Every state change is also written to audit_log via W2.
--
-- RLS: reports are visible only to the reporter, the assigned reviewer, and
-- admins. The subject of a report MUST NOT see it. Events follow the parent
-- report's visibility. Two-engineer review required on these policies per PID.

-- =============================================================================
-- Enums
-- =============================================================================

create type public.safeguarding_subject_type as enum (
  'provider', 'receiver', 'other'
);

create type public.safeguarding_severity as enum (
  'information', 'low', 'medium', 'high', 'immediate_risk'
);

create type public.safeguarding_status as enum (
  'submitted', 'triaged', 'investigating', 'escalated', 'resolved'
);

create type public.safeguarding_event_type as enum (
  'triage', 'assign', 'escalate', 'note', 'resolve'
);

-- =============================================================================
-- safeguarding_reports
-- =============================================================================

create table if not exists public.safeguarding_reports (
  id                  uuid primary key default gen_random_uuid(),
  reporter_id         uuid references public.profiles(id),
  reporter_role       public.app_role,
  subject_type        public.safeguarding_subject_type not null,
  subject_id          uuid references public.profiles(id),
  subject_description text,
  severity            public.safeguarding_severity not null default 'medium',
  summary             text not null,
  details             text,
  status              public.safeguarding_status not null default 'submitted',
  assigned_to         uuid references public.profiles(id),
  triage_deadline     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
  -- NO deleted_at column: safeguarding records are never deleted
);

create index safeguarding_reports_status_idx
  on public.safeguarding_reports (status, created_at);

create index safeguarding_reports_severity_idx
  on public.safeguarding_reports (severity, created_at)
  where status not in ('resolved');

create index safeguarding_reports_reporter_idx
  on public.safeguarding_reports (reporter_id, created_at desc)
  where reporter_id is not null;

create index safeguarding_reports_assigned_idx
  on public.safeguarding_reports (assigned_to)
  where assigned_to is not null;

create index safeguarding_reports_triage_deadline_idx
  on public.safeguarding_reports (triage_deadline)
  where status = 'submitted' and triage_deadline is not null;

-- updated_at trigger
create or replace function public.tg_safeguarding_reports_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger safeguarding_reports_updated_at
  before update on public.safeguarding_reports
  for each row execute function public.tg_safeguarding_reports_updated_at();

-- =============================================================================
-- safeguarding_report_events (append-only timeline)
-- =============================================================================

create table if not exists public.safeguarding_report_events (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.safeguarding_reports(id),
  actor_id    uuid references public.profiles(id),
  event_type  public.safeguarding_event_type not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index safeguarding_report_events_report_idx
  on public.safeguarding_report_events (report_id, created_at);

-- =============================================================================
-- Grants and RLS
-- =============================================================================

alter table public.safeguarding_reports enable row level security;
alter table public.safeguarding_report_events enable row level security;

-- Reports: grant insert to both anon and authenticated (anonymous reports).
-- Only admin can update (status transitions). No delete ever.
revoke all on public.safeguarding_reports from anon, authenticated;
grant insert on public.safeguarding_reports to anon, authenticated;
grant select on public.safeguarding_reports to authenticated;
grant update (status, severity, assigned_to, triage_deadline, updated_at)
  on public.safeguarding_reports to authenticated;

-- Events: insert and select for authenticated only. No update, no delete.
revoke all on public.safeguarding_report_events from anon, authenticated;
grant select, insert on public.safeguarding_report_events to authenticated;

-- =============================================================================
-- RLS policies: safeguarding_reports
-- =============================================================================

-- INSERT: anyone can submit (authenticated users stamp their id; anon allowed)
drop policy if exists safeguarding_reports_insert_authed on public.safeguarding_reports;
create policy safeguarding_reports_insert_authed
  on public.safeguarding_reports
  for insert
  to authenticated
  with check (
    reporter_id is null
    or reporter_id = app.current_profile_id()
  );

drop policy if exists safeguarding_reports_insert_anon on public.safeguarding_reports;
create policy safeguarding_reports_insert_anon
  on public.safeguarding_reports
  for insert
  to anon
  with check (
    reporter_id is null
  );

-- SELECT: reporter sees own reports, assigned reviewer sees assigned reports,
-- admins see all. The subject MUST NOT see reports about them.
drop policy if exists safeguarding_reports_reporter_read on public.safeguarding_reports;
create policy safeguarding_reports_reporter_read
  on public.safeguarding_reports
  for select
  to authenticated
  using (
    reporter_id is not null
    and reporter_id = app.current_profile_id()
  );

drop policy if exists safeguarding_reports_assigned_read on public.safeguarding_reports;
create policy safeguarding_reports_assigned_read
  on public.safeguarding_reports
  for select
  to authenticated
  using (
    assigned_to is not null
    and assigned_to = app.current_profile_id()
  );

drop policy if exists safeguarding_reports_admin_read on public.safeguarding_reports;
create policy safeguarding_reports_admin_read
  on public.safeguarding_reports
  for select
  to authenticated
  using (
    app.current_role() = 'admin'::public.app_role
  );

-- UPDATE: admin only, for status transitions
drop policy if exists safeguarding_reports_admin_update on public.safeguarding_reports;
create policy safeguarding_reports_admin_update
  on public.safeguarding_reports
  for update
  to authenticated
  using (
    app.current_role() = 'admin'::public.app_role
  )
  with check (
    app.current_role() = 'admin'::public.app_role
  );

-- No DELETE policy: default-deny handles it.

-- =============================================================================
-- RLS policies: safeguarding_report_events
-- =============================================================================

-- INSERT: admin only
drop policy if exists safeguarding_events_insert_admin on public.safeguarding_report_events;
create policy safeguarding_events_insert_admin
  on public.safeguarding_report_events
  for insert
  to authenticated
  with check (
    app.current_role() = 'admin'::public.app_role
  );

-- SELECT: follows parent report visibility (reporter, assigned, or admin)
drop policy if exists safeguarding_events_reporter_read on public.safeguarding_report_events;
create policy safeguarding_events_reporter_read
  on public.safeguarding_report_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.safeguarding_reports r
      where r.id = report_id
        and r.reporter_id is not null
        and r.reporter_id = app.current_profile_id()
    )
  );

drop policy if exists safeguarding_events_assigned_read on public.safeguarding_report_events;
create policy safeguarding_events_assigned_read
  on public.safeguarding_report_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.safeguarding_reports r
      where r.id = report_id
        and r.assigned_to is not null
        and r.assigned_to = app.current_profile_id()
    )
  );

drop policy if exists safeguarding_events_admin_read on public.safeguarding_report_events;
create policy safeguarding_events_admin_read
  on public.safeguarding_report_events
  for select
  to authenticated
  using (
    app.current_role() = 'admin'::public.app_role
  );

-- No UPDATE or DELETE policy on events: append-only by construction.
