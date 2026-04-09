-- 0002_audit_log.sql
--
-- W2 anchor. Append-only, hash-chained audit log consumed by every component
-- that mutates regulated state via the recordAuditEvent() server helper
-- (helper itself lands with C2 auth wiring, not this migration).
--
-- Tamper evidence: each row's row_hash is sha256 over
--   prev_hash || actor_id || action || subject_table || subject_id || before || after || created_at
-- and prev_hash points at the preceding row's row_hash, forming a chain that
-- cannot be edited without rewriting every subsequent hash. Concurrent
-- inserters are serialised through pg_advisory_xact_lock so the chain is
-- linear and reproducible; the lock is released automatically at txn commit.
--
-- Append-only by construction: there is NO update policy and NO delete policy
-- on this table. Revoke privileges are also issued below in case a future
-- migration accidentally grants them.

create extension if not exists pgcrypto;

create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  actor_id      uuid,
  actor_role    public.app_role,
  action        text not null,
  subject_table text not null,
  subject_id    text,
  before        jsonb,
  after         jsonb,
  prev_hash     bytea,
  row_hash      bytea not null,
  created_at    timestamptz not null default now()
);

create index if not exists audit_log_actor_idx
  on public.audit_log (actor_id, created_at desc);

create index if not exists audit_log_subject_idx
  on public.audit_log (subject_table, subject_id, created_at desc);

-- =============================================================================
-- Hash-chain trigger. BEFORE INSERT so row_hash is computed in a single pass
-- and the row lands on disk already tamper-evident.
-- =============================================================================
create or replace function public.tg_audit_log_hash_chain()
returns trigger
language plpgsql
as $$
declare
  v_prev bytea;
begin
  -- Serialise concurrent inserters. The lock key is a stable hash of the
  -- table name; the lock releases at transaction commit/rollback.
  perform pg_advisory_xact_lock(hashtext('public.audit_log'));

  select row_hash
    into v_prev
  from public.audit_log
  order by id desc
  limit 1;

  new.prev_hash  := v_prev;
  new.created_at := coalesce(new.created_at, now());

  new.row_hash := digest(
    coalesce(v_prev, ''::bytea)
      || convert_to(coalesce(new.actor_id::text, ''), 'UTF8')
      || convert_to(coalesce(new.actor_role::text, ''), 'UTF8')
      || convert_to(new.action, 'UTF8')
      || convert_to(new.subject_table, 'UTF8')
      || convert_to(coalesce(new.subject_id, ''), 'UTF8')
      || convert_to(coalesce(new.before::text, ''), 'UTF8')
      || convert_to(coalesce(new.after::text, ''), 'UTF8')
      || convert_to(new.created_at::text, 'UTF8'),
    'sha256'
  );

  return new;
end;
$$;

drop trigger if exists audit_log_hash_chain on public.audit_log;
create trigger audit_log_hash_chain
before insert on public.audit_log
for each row execute function public.tg_audit_log_hash_chain();

-- =============================================================================
-- Grants and RLS.
-- =============================================================================
alter table public.audit_log enable row level security;

revoke all on public.audit_log from anon, authenticated;
grant select, insert on public.audit_log to authenticated;
-- no update, no delete - ever

drop policy if exists audit_log_insert_authenticated on public.audit_log;
create policy audit_log_insert_authenticated
  on public.audit_log
  for insert
  to authenticated
  with check (
    actor_id is null
    or actor_id = app.current_profile_id()
    or app.current_role() = 'admin'::public.app_role
  );

drop policy if exists audit_log_self_select on public.audit_log;
create policy audit_log_self_select
  on public.audit_log
  for select
  to authenticated
  using (actor_id = app.current_profile_id());

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select
  on public.audit_log
  for select
  to authenticated
  using (app.current_role() = 'admin'::public.app_role);

-- Deliberately no UPDATE or DELETE policy. RLS default-deny handles both.
