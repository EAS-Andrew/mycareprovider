-- 0017_realtime_messaging.sql
--
-- C9: Realtime secure messaging. Replaces the C8 lightweight messaging bridge
-- (contact_threads / contact_thread_posts) with a full conversation-based
-- messaging system supporting:
--
--   - conversations (direct + group)
--   - conversation_participants (with unread tracking via last_read_at)
--   - messages (text, attachment, system, emergency_alert types)
--   - Data migration from contact_threads -> conversations and
--     contact_thread_posts -> messages
--   - message-attachments storage bucket (quarantine upload pattern)
--   - Supabase Realtime enabled on messages
--
-- DESIGN NOTES
-- -----------
-- 1. RLS follows the project pattern: helpers in the `app` schema, policies
--    as one-liners calling helpers. The core helper is
--    app.is_conversation_participant(conversation_id) which checks the
--    conversation_participants join table.
--
-- 2. Messages are append-only from the user perspective: no UPDATE or DELETE
--    policies for regular users. Soft-delete is handled via Server Actions
--    that set deleted_at (admin only).
--
-- 3. Rate limiting reuses the existing app.bump_rate_limit() from migration
--    0008. A BEFORE INSERT trigger on messages calls it with scope
--    'message.create' and a 60-per-minute cap.
--
-- 4. The data migration copies contact_threads into conversations and
--    contact_thread_posts into messages, preserving all history. A
--    legacy_thread_id column on conversations enables traceability.
--
-- 5. Emergency alert messages fan out to all care circle members by creating
--    participant entries for them on the conversation.

-- =============================================================================
-- conversations
-- =============================================================================
create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  type             text not null default 'direct'
                     check (type in ('direct', 'group')),
  subject          text,
  legacy_thread_id uuid references public.contact_threads(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists conversations_legacy_thread_idx
  on public.conversations (legacy_thread_id)
  where legacy_thread_id is not null;

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function app.tg_set_updated_at();

-- =============================================================================
-- conversation_participants
-- =============================================================================
create table if not exists public.conversation_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  left_at         timestamptz
);

create unique index if not exists conversation_participants_active_unique_idx
  on public.conversation_participants (conversation_id, profile_id)
  where left_at is null;

create index if not exists conversation_participants_profile_idx
  on public.conversation_participants (profile_id)
  where left_at is null;

create index if not exists conversation_participants_conversation_idx
  on public.conversation_participants (conversation_id)
  where left_at is null;

-- =============================================================================
-- messages
-- =============================================================================
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id),
  body            text not null check (char_length(body) between 1 and 4000),
  message_type    text not null default 'text'
                    check (message_type in ('text', 'attachment', 'system', 'emergency_alert')),
  attachment_url  text,
  attachment_name text,
  attachment_mime text,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

create index if not exists messages_conversation_created_desc_idx
  on public.messages (conversation_id, created_at desc);

create index if not exists messages_sender_idx
  on public.messages (sender_id);

-- =============================================================================
-- RLS helper: app.is_conversation_participant
-- =============================================================================
create or replace function app.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.conversation_participants
    where conversation_id = p_conversation_id
      and profile_id = app.current_profile_id()
      and left_at is null
  );
$$;

-- =============================================================================
-- conversations RLS
-- =============================================================================
alter table public.conversations enable row level security;

revoke all on public.conversations from anon, authenticated;
grant select, insert, update on public.conversations to authenticated;

-- Participants can read non-deleted conversations
drop policy if exists conversations_participant_read on public.conversations;
create policy conversations_participant_read
  on public.conversations
  for select
  to authenticated
  using (
    deleted_at is null
    and app.is_conversation_participant(id)
  );

-- Authenticated users can create conversations
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert
  on public.conversations
  for insert
  to authenticated
  with check (deleted_at is null);

-- Participants can update (e.g. edit subject)
drop policy if exists conversations_participant_update on public.conversations;
create policy conversations_participant_update
  on public.conversations
  for update
  to authenticated
  using (app.is_conversation_participant(id))
  with check (app.is_conversation_participant(id));

-- Admin full access
drop policy if exists conversations_admin on public.conversations;
create policy conversations_admin
  on public.conversations
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- conversation_participants RLS
-- =============================================================================
alter table public.conversation_participants enable row level security;

revoke all on public.conversation_participants from anon, authenticated;
grant select, insert, update on public.conversation_participants to authenticated;

-- Participants can see other participants in conversations they belong to
drop policy if exists conversation_participants_read on public.conversation_participants;
create policy conversation_participants_read
  on public.conversation_participants
  for select
  to authenticated
  using (
    left_at is null
    and app.is_conversation_participant(conversation_id)
  );

-- Participants can add new participants to a conversation they belong to
drop policy if exists conversation_participants_insert on public.conversation_participants;
create policy conversation_participants_insert
  on public.conversation_participants
  for insert
  to authenticated
  with check (
    left_at is null
    and app.is_conversation_participant(conversation_id)
  );

-- Self-insert: users can join a conversation if they are being added
-- (needed for createConversation flow where the creator adds themselves)
drop policy if exists conversation_participants_self_insert on public.conversation_participants;
create policy conversation_participants_self_insert
  on public.conversation_participants
  for insert
  to authenticated
  with check (
    profile_id = app.current_profile_id()
    and left_at is null
  );

-- Participants can update their own record (e.g. mark as read, leave)
drop policy if exists conversation_participants_self_update on public.conversation_participants;
create policy conversation_participants_self_update
  on public.conversation_participants
  for update
  to authenticated
  using (profile_id = app.current_profile_id())
  with check (profile_id = app.current_profile_id());

-- Admin full access
drop policy if exists conversation_participants_admin on public.conversation_participants;
create policy conversation_participants_admin
  on public.conversation_participants
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- messages RLS
-- =============================================================================
alter table public.messages enable row level security;

revoke all on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;

-- Participants can read non-deleted messages in their conversations
drop policy if exists messages_participant_read on public.messages;
create policy messages_participant_read
  on public.messages
  for select
  to authenticated
  using (
    deleted_at is null
    and app.is_conversation_participant(conversation_id)
  );

-- Participants can insert messages into their conversations
drop policy if exists messages_participant_insert on public.messages;
create policy messages_participant_insert
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = app.current_profile_id()
    and app.is_conversation_participant(conversation_id)
  );

-- Admin full access (for soft-delete etc.)
drop policy if exists messages_admin on public.messages;
create policy messages_admin
  on public.messages
  for all
  to authenticated
  using (app.current_role() = 'admin'::public.app_role)
  with check (app.current_role() = 'admin'::public.app_role);

-- Admin needs UPDATE grant for soft-delete
grant update on public.messages to authenticated;

-- =============================================================================
-- Rate limit trigger on messages
-- =============================================================================
create or replace function public.tg_messages_rate_limit()
returns trigger
language plpgsql
as $$
begin
  -- 60 messages per minute per sender. Reuses app.bump_rate_limit from 0008.
  perform app.bump_rate_limit('message.create', 60, 60);
  return new;
end;
$$;

drop trigger if exists tg_messages_rate_limit on public.messages;
create trigger tg_messages_rate_limit
before insert on public.messages
for each row execute function public.tg_messages_rate_limit();

-- =============================================================================
-- Data migration: contact_threads -> conversations, contact_thread_posts -> messages
-- =============================================================================

-- Step 1: Create a conversation for each existing contact_thread
insert into public.conversations (id, type, subject, legacy_thread_id, created_at, updated_at)
select
  gen_random_uuid(),
  'direct',
  cr.subject,
  ct.id,
  ct.created_at,
  ct.updated_at
from public.contact_threads ct
join public.contact_requests cr on cr.id = ct.contact_request_id
where ct.deleted_at is null;

-- Step 2: Create conversation_participants for each migrated conversation
-- Add the receiver
insert into public.conversation_participants (conversation_id, profile_id, joined_at)
select
  c.id,
  cr.receiver_id,
  c.created_at
from public.conversations c
join public.contact_threads ct on ct.id = c.legacy_thread_id
join public.contact_requests cr on cr.id = ct.contact_request_id;

-- Add the provider (resolve provider_profiles.id -> profiles.id via the FK)
insert into public.conversation_participants (conversation_id, profile_id, joined_at)
select
  c.id,
  pp.id,
  c.created_at
from public.conversations c
join public.contact_threads ct on ct.id = c.legacy_thread_id
join public.contact_requests cr on cr.id = ct.contact_request_id
join public.provider_profiles pp on pp.id = cr.provider_id;

-- Step 3: Copy contact_thread_posts -> messages
insert into public.messages (conversation_id, sender_id, body, message_type, created_at)
select
  c.id,
  ctp.author_id,
  ctp.body,
  'text',
  ctp.created_at
from public.contact_thread_posts ctp
join public.contact_threads ct on ct.id = ctp.thread_id
join public.conversations c on c.legacy_thread_id = ct.id;

-- =============================================================================
-- Storage bucket: message-attachments (quarantine upload pattern)
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

-- INSERT: upload into quarantine/<my-profile-id>/<filename>
drop policy if exists message_attachments_upload on storage.objects;
create policy message_attachments_upload
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = 'quarantine'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

-- SELECT: owner can read their own quarantine/clean objects; admin can read any
drop policy if exists message_attachments_read on storage.objects;
create policy message_attachments_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and (
      (
        (storage.foldername(name))[1] in ('quarantine', 'clean')
        and (storage.foldername(name))[2]::uuid = auth.uid()
      )
      or app.current_role() = 'admin'::public.app_role
    )
  );

-- DELETE: owner can delete quarantine objects; admin can delete any
drop policy if exists message_attachments_delete on storage.objects;
create policy message_attachments_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and (
      (
        (storage.foldername(name))[1] = 'quarantine'
        and (storage.foldername(name))[2]::uuid = auth.uid()
      )
      or app.current_role() = 'admin'::public.app_role
    )
  );

-- UPDATE: admin only (for promoting quarantine -> clean)
drop policy if exists message_attachments_admin_update on storage.objects;
create policy message_attachments_admin_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'message-attachments' and app.current_role() = 'admin'::public.app_role)
  with check (bucket_id = 'message-attachments' and app.current_role() = 'admin'::public.app_role);

-- =============================================================================
-- Enable Supabase Realtime on messages
-- =============================================================================
alter publication supabase_realtime add table public.messages;
