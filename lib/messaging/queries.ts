import "server-only";

import { createServerClient } from "@/lib/supabase/server";

import type {
  ConversationRow,
  ConversationWithPreview,
  MessageRow,
  MessageType,
  ConversationType,
  ParticipantInfo,
} from "./types";

/**
 * C9 read helpers for Server Components. Every query goes through the
 * user-scoped Supabase client so the C9 RLS policies in
 * supabase/migrations/0017_realtime_messaging.sql are the authoritative gate.
 */

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;

function clampLimit(requested: number | undefined, max: number): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(Math.floor(requested), max);
}

/**
 * List the current user's conversations with latest message preview and
 * unread count. Sorted by most recent message (or conversation creation
 * if no messages yet).
 */
export async function getMyConversations(): Promise<ConversationWithPreview[]> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Get conversations the user participates in
  const { data: participantRows, error: pError } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("profile_id", user.id)
    .is("left_at", null);

  if (pError) {
    throw new Error(`getMyConversations: ${pError.message}`);
  }

  if (!participantRows || participantRows.length === 0) return [];

  const conversationIds = participantRows.map(
    (r) => r.conversation_id as string,
  );

  // Fetch conversations
  const { data: conversations, error: cError } = await supabase
    .from("conversations")
    .select("id, type, subject, legacy_thread_id, created_at, updated_at")
    .in("id", conversationIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (cError) {
    throw new Error(`getMyConversations: ${cError.message}`);
  }

  if (!conversations || conversations.length === 0) return [];

  // For each conversation, fetch latest message, unread count, and participants
  const results: ConversationWithPreview[] = [];

  for (const conv of conversations) {
    const convId = conv.id as string;

    // Latest message
    const { data: latestMessages } = await supabase
      .from("messages")
      .select("body, created_at, sender_id, message_type")
      .eq("conversation_id", convId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    const latestMessage = latestMessages?.[0]
      ? {
          body: latestMessages[0].body as string,
          created_at: latestMessages[0].created_at as string,
          sender_id: latestMessages[0].sender_id as string,
          message_type: latestMessages[0].message_type as MessageType,
        }
      : null;

    // Get user's last_read_at for unread count
    const { data: myParticipation } = await supabase
      .from("conversation_participants")
      .select("last_read_at")
      .eq("conversation_id", convId)
      .eq("profile_id", user.id)
      .is("left_at", null)
      .maybeSingle();

    const lastReadAt = myParticipation?.last_read_at as string | null;

    let unreadCount = 0;
    if (lastReadAt) {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", convId)
        .is("deleted_at", null)
        .gt("created_at", lastReadAt)
        .neq("sender_id", user.id);
      unreadCount = count ?? 0;
    } else {
      // Never read - count all messages not from the user
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", convId)
        .is("deleted_at", null)
        .neq("sender_id", user.id);
      unreadCount = count ?? 0;
    }

    // Participants with display names
    const { data: participantData } = await supabase
      .from("conversation_participants")
      .select("profile_id, profiles!inner(display_name, role)")
      .eq("conversation_id", convId)
      .is("left_at", null);

    type ParticipantRow = {
      profile_id: string;
      profiles:
        | { display_name: string | null; role: string | null }
        | Array<{ display_name: string | null; role: string | null }>;
    };

    const participants: ParticipantInfo[] = (
      (participantData ?? []) as ParticipantRow[]
    ).map((p) => {
      const profile = Array.isArray(p.profiles)
        ? (p.profiles[0] ?? null)
        : p.profiles;
      return {
        profile_id: p.profile_id as string,
        display_name: profile?.display_name ?? null,
        role: profile?.role ?? null,
      };
    });

    results.push({
      id: convId,
      type: conv.type as ConversationType,
      subject: (conv.subject as string | null) ?? null,
      legacy_thread_id: (conv.legacy_thread_id as string | null) ?? null,
      created_at: conv.created_at as string,
      updated_at: conv.updated_at as string,
      latest_message: latestMessage,
      unread_count: unreadCount,
      participants,
    });
  }

  // Sort by latest message date, falling back to updated_at
  results.sort((a, b) => {
    const aDate = a.latest_message?.created_at ?? a.updated_at;
    const bDate = b.latest_message?.created_at ?? b.updated_at;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  return results;
}

/**
 * Get a single conversation by ID. Returns null if RLS hides it.
 */
export async function getConversation(
  conversationId: string,
): Promise<ConversationRow | null> {
  if (!conversationId) return null;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("conversations")
    .select("id, type, subject, legacy_thread_id, created_at, updated_at")
    .eq("id", conversationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getConversation: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id as string,
    type: data.type as ConversationType,
    subject: (data.subject as string | null) ?? null,
    legacy_thread_id: (data.legacy_thread_id as string | null) ?? null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

/**
 * Get paginated messages for a conversation, newest first.
 * Returns messages in chronological order (oldest first) for display.
 */
export async function getMessages(
  conversationId: string,
  options?: { limit?: number; cursor?: string | null },
): Promise<{ messages: MessageRow[]; nextCursor: string | null }> {
  if (!conversationId) return { messages: [], nextCursor: null };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { messages: [], nextCursor: null };

  const limit = clampLimit(options?.limit, MAX_MESSAGE_LIMIT);

  let query = supabase
    .from("messages")
    .select(
      "id, conversation_id, sender_id, body, message_type, attachment_url, attachment_name, attachment_mime, created_at, edited_at",
    )
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options?.cursor) {
    query = query.lt("created_at", options.cursor);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`getMessages: ${error.message}`);
  }

  type RawMessage = {
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    message_type: string;
    attachment_url: string | null;
    attachment_name: string | null;
    attachment_mime: string | null;
    created_at: string;
    edited_at: string | null;
  };

  const raw = (data ?? []) as RawMessage[];
  const hasMore = raw.length > limit;
  const slice = hasMore ? raw.slice(0, limit) : raw;

  // Capture the cursor BEFORE reversing. The slice is in DESC order, so
  // the last element is the oldest message - the correct cursor for
  // "load older" pagination.
  const nextCursor = hasMore ? slice[slice.length - 1].created_at : null;

  // Reverse to chronological order for display
  const messages: MessageRow[] = slice.reverse().map((r) => ({
    id: r.id,
    conversation_id: r.conversation_id,
    sender_id: r.sender_id,
    body: r.body,
    message_type: r.message_type as MessageType,
    attachment_url: r.attachment_url,
    attachment_name: r.attachment_name,
    attachment_mime: r.attachment_mime,
    created_at: r.created_at,
    edited_at: r.edited_at,
  }));

  return { messages, nextCursor };
}

/**
 * Get participants for a conversation with display names and roles.
 */
export async function getConversationParticipants(
  conversationId: string,
): Promise<ParticipantInfo[]> {
  if (!conversationId) return [];

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("conversation_participants")
    .select("profile_id, profiles!inner(display_name, role)")
    .eq("conversation_id", conversationId)
    .is("left_at", null);

  if (error) {
    throw new Error(`getConversationParticipants: ${error.message}`);
  }

  type Row = {
    profile_id: string;
    profiles:
      | { display_name: string | null; role: string | null }
      | Array<{ display_name: string | null; role: string | null }>;
  };

  return ((data ?? []) as Row[]).map((r) => {
    const profile = Array.isArray(r.profiles)
      ? (r.profiles[0] ?? null)
      : r.profiles;
    return {
      profile_id: r.profile_id as string,
      display_name: profile?.display_name ?? null,
      role: profile?.role ?? null,
    };
  });
}
