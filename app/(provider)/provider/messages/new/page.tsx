import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { createConversation } from "@/lib/messaging/actions";

export const metadata = {
  title: "New message - MyCareProvider",
};

export default async function ProviderNewMessagePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  // Get accepted contacts (receivers who have accepted contact requests to this provider)
  const { data: contacts } = await supabase
    .from("contact_requests")
    .select("id, receiver_id, subject, profiles!receiver_id(display_name)")
    .eq("provider_id", user.id)
    .eq("status", "accepted")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  type ContactRow = {
    id: string;
    receiver_id: string;
    subject: string;
    profiles:
      | { display_name: string | null }
      | Array<{ display_name: string | null }>
      | null;
  };

  const rows = (contacts ?? []) as ContactRow[];

  async function startConversation(formData: FormData) {
    "use server";
    const receiverId = formData.get("receiver_id");
    if (typeof receiverId !== "string" || !receiverId) return;

    const { conversationId } = await createConversation([receiverId]);
    redirect(`/provider/messages/${conversationId}`);
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link
          href="/provider/messages"
          className="text-sm text-brand hover:underline"
        >
          Back to messages
        </Link>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-ink">
          New conversation
        </h1>
        <p className="mt-2 text-ink-muted">
          Choose a care receiver from your accepted contacts to start a
          conversation.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="font-heading text-lg font-semibold text-ink">
            No accepted contacts
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            You need to accept a contact request before you can start messaging.
          </p>
          <Link
            href="/provider/contacts"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            View contact requests
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {rows.map((row) => {
            const profile = Array.isArray(row.profiles)
              ? (row.profiles[0] ?? null)
              : row.profiles;
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {profile?.display_name ?? "Care receiver"}
                  </p>
                  <p className="mt-1 truncate text-sm text-ink-muted">
                    {row.subject}
                  </p>
                </div>
                <form action={startConversation}>
                  <input
                    type="hidden"
                    name="receiver_id"
                    value={row.receiver_id}
                  />
                  <button
                    type="submit"
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
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
