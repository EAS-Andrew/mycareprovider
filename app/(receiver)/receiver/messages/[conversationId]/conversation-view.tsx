"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import { createBrowserClient } from "@/lib/supabase/client";
import { subscribeToMessages } from "@/lib/messaging/realtime";
import { sendMessage, uploadAttachment, markAsRead } from "@/lib/messaging/actions";
import type { MessageRow, ParticipantInfo, MessageType } from "@/lib/messaging/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SenderBadge({
  participant,
}: {
  participant: ParticipantInfo | undefined;
}) {
  if (!participant) return null;
  const roleLabel =
    participant.role === "provider"
      ? "Provider"
      : participant.role === "receiver"
        ? "You"
        : participant.role === "family_member"
          ? "Family"
          : participant.role ?? "";
  return (
    <span className="text-xs font-medium text-ink-muted">
      {participant.display_name ?? roleLabel}
    </span>
  );
}

function MessageBubble({
  message,
  isOwn,
  participant,
}: {
  message: MessageRow;
  isOwn: boolean;
  participant: ParticipantInfo | undefined;
}) {
  const isEmergency = message.message_type === "emergency_alert";
  const isSystem = message.message_type === "system";
  const isAttachment = message.message_type === "attachment";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <p className="rounded-full bg-surface px-4 py-1 text-xs text-ink-muted">
          {message.body}
        </p>
      </div>
    );
  }

  if (isEmergency) {
    return (
      <div className="mx-auto max-w-md rounded-lg border-2 border-danger bg-danger/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-danger"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <span className="text-sm font-semibold text-danger">
            Emergency Alert
          </span>
        </div>
        <p className="mt-2 text-sm text-ink">{message.body}</p>
        <p className="mt-1 text-xs text-ink-muted">
          <SenderBadge participant={participant} /> - {formatTime(message.created_at)}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 ${
          isOwn
            ? "bg-brand text-brand-fg"
            : "bg-surface border border-border text-ink"
        }`}
      >
        {!isOwn && <SenderBadge participant={participant} />}
        {isAttachment ? (
          <div className="flex items-center gap-2">
            <svg
              className={`h-4 w-4 ${isOwn ? "text-brand-fg" : "text-ink-muted"}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
              />
            </svg>
            <span className="text-sm underline">
              {message.attachment_name ?? "Attachment"}
            </span>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{message.body}</p>
        )}
        <p
          className={`mt-1 text-xs ${isOwn ? "text-brand-fg/70" : "text-ink-muted"}`}
        >
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

export function ConversationView({
  conversationId,
  conversationTitle,
  initialMessages,
  participants,
  currentUserId,
  backHref,
}: {
  conversationId: string;
  conversationTitle: string;
  initialMessages: MessageRow[];
  participants: ParticipantInfo[];
  currentUserId: string;
  backHref: string;
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const participantMap = new Map(
    participants.map((p) => [p.profile_id, p]),
  );

  // Subscribe to realtime messages
  useEffect(() => {
    const supabase = createBrowserClient();
    const unsubscribe = subscribeToMessages(supabase, conversationId, (msg) => {
      setMessages((prev) => {
        // Deduplicate - optimistic messages may already be in state
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    return unsubscribe;
  }, [conversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Mark as read when new messages appear
  useEffect(() => {
    if (messages.length > 0) {
      markAsRead(conversationId).catch(() => {});
    }
  }, [messages.length, conversationId]);

  function handleSend() {
    const text = inputValue.trim();
    if (!text) return;
    setInputValue("");

    startTransition(async () => {
      try {
        await sendMessage(conversationId, text);
      } catch {
        // Re-add the text if sending failed
        setInputValue(text);
      }
    });
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      try {
        await uploadAttachment(conversationId, formData);
      } catch (err) {
        console.error("Upload failed:", err);
      }
    });

    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-border pb-4">
        <Link
          href={backHref}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          aria-label="Back to messages"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-ink">
            {conversationTitle}
          </h1>
          <p className="text-xs text-ink-muted">
            {participants.length} participants
          </p>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-ink-muted">
              No messages yet. Start the conversation below.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.sender_id === currentUserId}
              participant={participantMap.get(msg.sender_id)}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border pt-4">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            aria-label="Attach file"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
              />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt"
          />
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message..."
            rows={1}
            className="min-h-10 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isPending || !inputValue.trim()}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
          >
            {isPending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}
