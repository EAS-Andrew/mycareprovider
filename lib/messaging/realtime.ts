"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MessageRow, MessageType } from "./types";

/**
 * C9 Realtime helper. Subscribes to INSERT events on the messages table
 * for a given conversation, calling the provided callback with each new
 * message. Returns an unsubscribe function.
 *
 * Usage in a client component:
 *
 *   const unsub = subscribeToMessages(supabase, conversationId, (msg) => {
 *     setMessages(prev => [...prev, msg]);
 *   });
 *   // on cleanup:
 *   unsub();
 */
export function subscribeToMessages(
  supabase: SupabaseClient,
  conversationId: string,
  onMessage: (message: MessageRow) => void,
): () => void {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        const message: MessageRow = {
          id: row.id as string,
          conversation_id: row.conversation_id as string,
          sender_id: row.sender_id as string,
          body: row.body as string,
          message_type: row.message_type as MessageType,
          attachment_url: (row.attachment_url as string | null) ?? null,
          attachment_name: (row.attachment_name as string | null) ?? null,
          attachment_mime: (row.attachment_mime as string | null) ?? null,
          created_at: row.created_at as string,
          edited_at: (row.edited_at as string | null) ?? null,
        };
        onMessage(message);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
