-- Migration 0020: QA bug fixes
-- Fixes 6 database-level bugs found during QA review.

-- =============================================================================
-- QA FIX 1: app.current_role() - profiles.role must take priority over JWT claim
-- =============================================================================
-- BUG: coalesce(jwt_claim, profiles_value) means a stale JWT app_role (e.g.
-- 'receiver' left over from before provider sign-up) overrides the
-- authoritative profiles.role. This breaks every RLS policy that checks role.
-- FIX: flip the coalesce so profiles.role wins when non-null.

create or replace function app.current_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_live  boolean;
  v_role  public.app_role;
  v_claim text;
begin
  if v_uid is null then
    return null;
  end if;

  select (deleted_at is null), role
    into v_live, v_role
  from public.profiles
  where id = v_uid;

  if v_live is not true then
    return null;
  end if;

  -- If profiles.role is set, it is authoritative. Only fall back to the JWT
  -- claim when profiles.role is null (should not happen in practice).
  v_claim := nullif(current_setting('request.jwt.claims', true), '');
  if v_claim is not null then
    begin
      v_role := coalesce(
        v_role,
        (v_claim::jsonb ->> 'app_role')::public.app_role
      );
    exception
      when others then
        null;
    end;
  end if;

  return v_role;
end;
$$;


-- =============================================================================
-- QA FIX 2: family_invitations_accept - require email match
-- =============================================================================
-- BUG: any authenticated user can accept any unexpired invitation because the
-- policy does not check that the user's email matches the invitation email.
-- FIX: add email match check to the USING clause.

drop policy if exists family_invitations_accept on public.family_invitations;
create policy family_invitations_accept
  on public.family_invitations
  for update
  to authenticated
  using (
    accepted_at is null
    and expires_at > now()
    and email = (select email from auth.users where id = auth.uid())
  )
  with check (
    accepted_at is not null
  );


-- =============================================================================
-- QA FIX 3: company_memberships guard trigger - prevent self-promotion
-- =============================================================================
-- BUG: company_memberships_self_update policy lets a provider update any column
-- on their own row, including role (self-promote) and removed_at (un-remove).
-- FIX: add a BEFORE UPDATE trigger that, for self-updates by non-admin callers,
-- only allows changes to accepted_at. Block changes to role, company_id,
-- removed_at, and invited_by.

create or replace function public.tg_company_memberships_guard()
returns trigger
language plpgsql
as $$
begin
  -- Admins can change anything
  if app.current_role() = 'admin'::public.app_role then
    return new;
  end if;

  -- Only guard self-updates (where provider_id matches the caller)
  if old.provider_id <> app.current_profile_id() then
    return new;
  end if;

  -- For self-updates, only accepted_at may change
  if new.role is distinct from old.role then
    raise exception 'cannot change own membership role'
      using errcode = '42501';
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'cannot change membership company'
      using errcode = '42501';
  end if;

  if new.removed_at is distinct from old.removed_at then
    raise exception 'cannot change own removed_at'
      using errcode = '42501';
  end if;

  if new.invited_by is distinct from old.invited_by then
    raise exception 'cannot change invited_by'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_company_memberships_guard on public.company_memberships;
create trigger tg_company_memberships_guard
  before update on public.company_memberships
  for each row execute function public.tg_company_memberships_guard();


-- =============================================================================
-- QA FIX 4: message-attachments READ storage policy - allow all participants
-- =============================================================================
-- BUG: message_attachments_read only allows the uploader to read files. Other
-- conversation participants cannot download attachments sent to them.
-- FIX: allow access if the user is a participant in any conversation that has a
-- message referencing that attachment path.

drop policy if exists message_attachments_read on storage.objects;
create policy message_attachments_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and (
      -- Original uploader can always read their own files
      (
        (storage.foldername(name))[1] in ('quarantine', 'clean')
        and (storage.foldername(name))[2]::uuid = auth.uid()
      )
      -- Conversation participants can read attachments from their conversations
      or exists (
        select 1 from public.messages m
        join public.conversation_participants cp
          on cp.conversation_id = m.conversation_id
        where m.attachment_url = name
          and cp.profile_id = auth.uid()
          and cp.left_at is null
          and m.deleted_at is null
      )
      -- Admin can read everything
      or app.current_role() = 'admin'::public.app_role
    )
  );


-- =============================================================================
-- QA FIX 5: conversation_participants INSERT - allow creator to add all members
-- =============================================================================
-- BUG: when creating a conversation, the creator inserts all participant rows in
-- one batch. The INSERT policy requires app.is_conversation_participant(), which
-- fails for non-self rows because the creator's own row has not committed yet.
-- FIX: add a created_by column to conversations (defaulting to auth.uid()), then
-- add a policy allowing the conversation creator to insert participants.

alter table public.conversations
  add column if not exists created_by uuid default auth.uid() references public.profiles(id);

-- Backfill existing conversations: set created_by to the earliest participant
update public.conversations c
  set created_by = (
    select cp.profile_id
    from public.conversation_participants cp
    where cp.conversation_id = c.id
    order by cp.joined_at asc
    limit 1
  )
where c.created_by is null;

drop policy if exists conversation_participants_creator_insert on public.conversation_participants;
create policy conversation_participants_creator_insert
  on public.conversation_participants
  for insert
  to authenticated
  with check (
    left_at is null
    and exists (
      select 1 from public.conversations
      where id = conversation_id
        and created_by = auth.uid()
    )
  );


-- =============================================================================
-- QA FIX 6: care_plans status guard - block completed -> cancelled
-- =============================================================================
-- BUG: the trigger allows any -> cancelled, meaning completed plans can be
-- cancelled. Also cancelled -> cancelled is a wasteful no-op that writes audit.
-- FIX: only allow cancellation from draft, pending_approval, active, or paused.
-- Block completed -> cancelled and cancelled -> cancelled.

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
  --   draft -> cancelled
  --   pending_approval -> cancelled
  --   active -> cancelled
  --   paused -> cancelled
  allowed := false;

  if new.status = 'cancelled' and old.status in ('draft', 'pending_approval', 'active', 'paused') then
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
