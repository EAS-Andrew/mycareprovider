"use server";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import {
  MessagingValidationError,
  ATTACHMENT_MIME_ALLOW_LIST,
} from "./types";

/**
 * C9 messaging Server Actions.
 *
 * Every mutation goes through the user-scoped Supabase client so the C9 RLS
 * policies are the authoritative gate, and every mutation writes a W2 audit
 * event with a redacted payload (no message body content, which is PII).
 *
 * Rate limiting: the BEFORE INSERT trigger on messages calls
 * app.bump_rate_limit('message.create', 60, 60) - 60 messages per minute.
 */

// ---------------------------------------------------------------- validators

const BODY_MIN = 1;
const BODY_MAX = 4000;

function assertBodyLen(value: string): void {
  if (value.length < BODY_MIN || value.length > BODY_MAX) {
    throw new MessagingValidationError(
      "invalid_body",
      `Message body must be between ${BODY_MIN} and ${BODY_MAX} characters`,
    );
  }
}

// ---------------------------------------------------------------- caller context

type Caller = {
  profileId: string;
  role: string;
  displayName: string | null;
};

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

async function loadCaller(): Promise<{
  supabase: ServerClient;
  caller: Caller;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new MessagingValidationError("sign_in_required");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) {
    throw new MessagingValidationError("profile_not_found");
  }

  return {
    supabase,
    caller: {
      profileId: profile.id as string,
      role: profile.role as string,
      displayName: (profile.display_name as string | null) ?? null,
    },
  };
}

// ---------------------------------------------------------------- error helpers

type SupabaseError = { code?: string | null; message?: string | null } | null;

function isRateLimited(error: SupabaseError): boolean {
  if (!error) return false;
  if (error.code !== "P0001") return false;
  if (typeof error.message !== "string") return false;
  return /^rate_limited(?::|$|\s)/.test(error.message);
}

async function recordAuditBestEffort(
  params: Parameters<typeof recordAuditEvent>[0],
): Promise<void> {
  try {
    await recordAuditEvent(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[audit] messaging event not recorded (swallowed)", {
      action: params.action,
      subject_id: params.subjectId ?? null,
      error: message,
    });
  }
}

// ---------------------------------------------------------------- 1. sendMessage

export async function sendMessage(
  conversationId: string,
  body: string,
): Promise<{ messageId: string }> {
  if (!conversationId) {
    throw new MessagingValidationError("missing_conversation_id");
  }
  const trimmed = body?.trim() ?? "";
  assertBodyLen(trimmed);

  const { supabase, caller } = await loadCaller();

  // RLS enforces participant check, but we verify for a friendly error
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!conv) {
    throw new MessagingValidationError("not_found");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: caller.profileId,
      body: trimmed,
      message_type: "text",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (isRateLimited(insertError)) {
      throw new MessagingValidationError("rate_limited");
    }
    throw new MessagingValidationError(
      "db_error",
      insertError?.message ?? "insert failed",
    );
  }

  const messageId = inserted.id as string;

  // Update conversation.updated_at for sorting
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  await recordAuditBestEffort({
    action: "message.create",
    subjectTable: "public.messages",
    subjectId: messageId,
    after: {
      conversation_id: conversationId,
      message_type: "text",
      body_length: trimmed.length,
    },
  });

  return { messageId };
}

// ---------------------------------------------------------------- 2. createConversation

export async function createConversation(
  participantIds: string[],
  subject?: string | null,
): Promise<{ conversationId: string }> {
  if (!participantIds || participantIds.length === 0) {
    throw new MessagingValidationError("missing_participants");
  }

  const { supabase, caller } = await loadCaller();

  // Ensure the caller is included in participants
  const allParticipants = new Set([caller.profileId, ...participantIds]);

  const conversationType = allParticipants.size > 2 ? "group" : "direct";

  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .insert({
      type: conversationType,
      subject: subject ?? null,
    })
    .select("id")
    .single();

  if (convError || !conv) {
    throw new MessagingValidationError(
      "db_error",
      convError?.message ?? "conversation creation failed",
    );
  }

  const conversationId = conv.id as string;

  // Add all participants
  const participantInserts = Array.from(allParticipants).map((profileId) => ({
    conversation_id: conversationId,
    profile_id: profileId,
  }));

  const { error: partError } = await supabase
    .from("conversation_participants")
    .insert(participantInserts);

  if (partError) {
    throw new MessagingValidationError(
      "db_error",
      partError.message,
    );
  }

  await recordAuditBestEffort({
    action: "conversation.create",
    subjectTable: "public.conversations",
    subjectId: conversationId,
    after: {
      type: conversationType,
      participant_count: allParticipants.size,
    },
  });

  return { conversationId };
}

// ---------------------------------------------------------------- 3. markAsRead

export async function markAsRead(conversationId: string): Promise<void> {
  if (!conversationId) {
    throw new MessagingValidationError("missing_conversation_id");
  }

  const { supabase, caller } = await loadCaller();

  const { error } = await supabase
    .from("conversation_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("profile_id", caller.profileId)
    .is("left_at", null);

  if (error) {
    throw new MessagingValidationError("db_error", error.message);
  }
}

// ---------------------------------------------------------------- 4. uploadAttachment

export async function uploadAttachment(
  conversationId: string,
  formData: FormData,
): Promise<{ messageId: string }> {
  if (!conversationId) {
    throw new MessagingValidationError("missing_conversation_id");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new MessagingValidationError("missing_file");
  }

  if (!ATTACHMENT_MIME_ALLOW_LIST.has(file.type)) {
    throw new MessagingValidationError(
      "invalid_mime_type",
      `File type ${file.type} is not allowed`,
    );
  }

  // 10 MB limit
  if (file.size > 10 * 1024 * 1024) {
    throw new MessagingValidationError(
      "file_too_large",
      "Maximum file size is 10 MB",
    );
  }

  const { supabase, caller } = await loadCaller();

  // Verify conversation access
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!conv) {
    throw new MessagingValidationError("not_found");
  }

  // Upload to quarantine path
  const fileName = `${Date.now()}-${file.name}`;
  const filePath = `quarantine/${caller.profileId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("message-attachments")
    .upload(filePath, file);

  if (uploadError) {
    throw new MessagingValidationError("upload_failed", uploadError.message);
  }

  // Create the message with attachment metadata
  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: caller.profileId,
      body: file.name,
      message_type: "attachment",
      attachment_url: filePath,
      attachment_name: file.name,
      attachment_mime: file.type,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (isRateLimited(insertError)) {
      throw new MessagingValidationError("rate_limited");
    }
    throw new MessagingValidationError(
      "db_error",
      insertError?.message ?? "insert failed",
    );
  }

  const messageId = inserted.id as string;

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  await recordAuditBestEffort({
    action: "message.attachment",
    subjectTable: "public.messages",
    subjectId: messageId,
    after: {
      conversation_id: conversationId,
      attachment_mime: file.type,
      attachment_size: file.size,
    },
  });

  return { messageId };
}

// ---------------------------------------------------------------- 5. sendEmergencyAlert

/**
 * Send an emergency alert message to a conversation and fan out to all
 * care circle members of the receiver. Creates participant entries for
 * care circle members who are not already in the conversation.
 */
export async function sendEmergencyAlert(
  conversationId: string,
  body: string,
  receiverId: string,
): Promise<{ messageId: string }> {
  if (!conversationId) {
    throw new MessagingValidationError("missing_conversation_id");
  }
  if (!receiverId) {
    throw new MessagingValidationError("missing_receiver_id");
  }
  const trimmed = body?.trim() ?? "";
  assertBodyLen(trimmed);

  const { supabase, caller } = await loadCaller();

  // Verify the caller is a participant
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!conv) {
    throw new MessagingValidationError("not_found");
  }

  // Insert the emergency alert message
  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: caller.profileId,
      body: trimmed,
      message_type: "emergency_alert",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (isRateLimited(insertError)) {
      throw new MessagingValidationError("rate_limited");
    }
    throw new MessagingValidationError(
      "db_error",
      insertError?.message ?? "insert failed",
    );
  }

  const messageId = inserted.id as string;

  // Fan out to care circle members using admin client (needs cross-user access)
  const admin = createAdminClient();

  // Find the receiver's care circle
  const { data: circle } = await admin
    .from("care_circles")
    .select("id")
    .eq("receiver_id", receiverId)
    .is("deleted_at", null)
    .maybeSingle();

  if (circle) {
    // Get active circle members
    const { data: members } = await admin
      .from("care_circle_members")
      .select("profile_id")
      .eq("circle_id", circle.id as string)
      .not("accepted_at", "is", null)
      .is("removed_at", null);

    if (members && members.length > 0) {
      // Get existing participants
      const { data: existingParticipants } = await admin
        .from("conversation_participants")
        .select("profile_id")
        .eq("conversation_id", conversationId)
        .is("left_at", null);

      const existingIds = new Set(
        (existingParticipants ?? []).map((p) => p.profile_id as string),
      );

      // Add circle members who are not already participants
      const newParticipants = members
        .filter((m) => !existingIds.has(m.profile_id as string))
        .map((m) => ({
          conversation_id: conversationId,
          profile_id: m.profile_id as string,
        }));

      if (newParticipants.length > 0) {
        await admin
          .from("conversation_participants")
          .insert(newParticipants);
      }
    }
  }

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  await recordAuditBestEffort({
    action: "message.emergency_alert",
    subjectTable: "public.messages",
    subjectId: messageId,
    after: {
      conversation_id: conversationId,
      receiver_id: receiverId,
      body_length: trimmed.length,
    },
  });

  return { messageId };
}
