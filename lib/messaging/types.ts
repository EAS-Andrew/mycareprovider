/**
 * TypeScript types for C9 realtime messaging.
 *
 * Matches the schema in supabase/migrations/0017_realtime_messaging.sql.
 */

export const MESSAGE_TYPES = [
  "text",
  "attachment",
  "system",
  "emergency_alert",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const CONVERSATION_TYPES = ["direct", "group"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export type ConversationRow = {
  id: string;
  type: ConversationType;
  subject: string | null;
  legacy_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationParticipantRow = {
  id: string;
  conversation_id: string;
  profile_id: string;
  joined_at: string;
  last_read_at: string | null;
  left_at: string | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  message_type: MessageType;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  created_at: string;
  edited_at: string | null;
};

export type ConversationWithPreview = ConversationRow & {
  latest_message: Pick<MessageRow, "body" | "created_at" | "sender_id" | "message_type"> | null;
  unread_count: number;
  participants: Array<{
    profile_id: string;
    display_name: string | null;
    role: string | null;
  }>;
};

export type ParticipantInfo = {
  profile_id: string;
  display_name: string | null;
  role: string | null;
};

export class MessagingValidationError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "MessagingValidationError";
    this.code = code;
  }
}

/**
 * Allowed MIME types for message attachments.
 */
export const ATTACHMENT_MIME_ALLOW_LIST = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
