import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { createConversation } from "@/lib/messaging/actions";

export const metadata = {
  title: "New message - MyCareProvider",
};

export default async function ReceiverNewMessagePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  // Get accepted contacts (providers the receiver has an accepted contact request with)
  const { data: contacts } = await supabase
    .from("contact_requests")
    .select(
      "id, provider_id, subject, provider_profiles!provider_id(headline)",
    )
    .eq("receiver_id", user.id)
    .eq("status", "accepted")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  type ContactRow = {
    id: string;
    provider_id: string;
    subject: string;
    provider_profiles:
      | { headline: string | null }
      | Array<{ headline: string | null }>
      | null;
  };

  const rows = (contacts ?? []) as ContactRow[];

  async function startConversation(formData: FormData) {
    "use server";
    const providerId = formData.get("provider_id");
    if (typeof providerId !== "string" || !providerId) return;

    const { conversationId } = await createConversation([providerId]);
    redirect(`/receiver/messages/${conversationId}`);
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link
          href="/receiver/messages"
          className="text-sm text-brand hover:underline"
        >
          Back to messages
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          New conversation
        </h1>
        <p className="mt-2 text-ink-muted">
          Choose a provider from your accepted contacts to start a conversation.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">
            No accepted contacts
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            You need an accepted contact request before you can start messaging.
          </p>
          <Link
            href="/providers"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Find providers
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {rows.map((row) => {
            const provider = Array.isArray(row.provider_profiles)
              ? (row.provider_profiles[0] ?? null)
              : row.provider_profiles;
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {provider?.headline ?? "Care provider"}
                  </p>
                  <p className="mt-1 truncate text-sm text-ink-muted">
                    {row.subject}
                  </p>
                </div>
                <form action={startConversation}>
                  <input
                    type="hidden"
                    name="provider_id"
                    value={row.provider_id}
                  />
                  <button
                    type="submit"
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                  >
                    Start conversation
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
