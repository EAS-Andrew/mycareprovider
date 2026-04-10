import Link from "next/link";

import { getMyConversations } from "@/lib/messaging/queries";
import type { MessageType } from "@/lib/messaging/types";

export const metadata = {
  title: "Messages - MyCareProvider",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messagePreview(body: string, messageType: MessageType): string {
  if (messageType === "attachment") return "Sent an attachment";
  if (messageType === "emergency_alert") return "Emergency alert";
  if (messageType === "system") return body;
  return body.length > 80 ? body.slice(0, 80) + "..." : body;
}

export default async function ReceiverMessagesPage() {
  const conversations = await getMyConversations();

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Messages
          </h1>
          <p className="mt-2 text-ink-muted">
            Your conversations with care providers.
          </p>
        </div>
        <Link
          href="/receiver/messages/new"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          New message
        </Link>
      </header>

      {conversations.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">
            No conversations yet
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Once a provider accepts your contact request, you can start
            messaging here.
          </p>
          <Link
            href="/receiver/contacts"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            View contacts
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {conversations.map((conv) => {
            const otherParticipants = conv.participants.filter(
              (p) => p.role !== "receiver",
            );
            const displayName =
              conv.subject ??
              otherParticipants
                .map((p) => p.display_name ?? "Care provider")
                .join(", ") ??
              "Conversation";

            return (
              <li key={conv.id}>
                <Link
                  href={`/receiver/messages/${conv.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <p className="truncate font-medium text-ink">
                        {displayName}
                      </p>
                      {conv.unread_count > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-medium text-brand-fg">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    {conv.latest_message && (
                      <p className="mt-1 truncate text-sm text-ink-muted">
                        {messagePreview(
                          conv.latest_message.body,
                          conv.latest_message.message_type,
                        )}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink-muted">
                      {conv.latest_message
                        ? formatDate(conv.latest_message.created_at)
                        : formatDate(conv.created_at)}
                    </p>
                  </div>
                  <svg
                    className="h-5 w-5 shrink-0 text-ink-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
