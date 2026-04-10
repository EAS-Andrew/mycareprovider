import Link from "next/link";

import { createServerClient } from "@/lib/supabase/server";

async function getDashboardCounts() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { unreadMessages: 0, pendingApproval: 0 };

  const [participantsRes, carePlansRes] = await Promise.all([
    supabase
      .from("conversation_participants")
      .select("conversation_id, last_read_at")
      .eq("profile_id", user.id)
      .is("left_at", null),
    supabase
      .from("care_plans")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", user.id)
      .eq("status", "pending_approval")
      .is("deleted_at", null),
  ]);

  const pendingApproval = carePlansRes.count ?? 0;

  let unreadMessages = 0;
  const participants = participantsRes.data ?? [];
  for (const p of participants) {
    const lastRead = p.last_read_at as string | null;
    const query = supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", p.conversation_id as string)
      .neq("sender_id", user.id);
    if (lastRead) {
      query.gt("created_at", lastRead);
    }
    const { count } = await query;
    if ((count ?? 0) > 0) unreadMessages++;
  }

  return { unreadMessages, pendingApproval };
}

export default async function ReceiverHome() {
  const counts = await getDashboardCounts();
  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Welcome, care receiver
        </h1>
        <p className="mt-3 text-ink-muted">
          This is where you will find providers, arrange visits, and manage care
          for yourself or someone you love.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/providers"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <h2 className="font-heading font-semibold text-ink">Find a provider</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Browse verified care providers in your area.
          </p>
        </Link>
        <Link
          href="/receiver/messages"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-ink">Messages</h2>
            {counts.unreadMessages > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-medium text-brand-fg">
                {counts.unreadMessages}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            View conversations with your care providers.
          </p>
        </Link>
        <Link
          href="/receiver/contacts"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <h2 className="font-heading font-semibold text-ink">Contact requests</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Track your outreach to providers.
          </p>
        </Link>
        <Link
          href="/receiver/care-plans"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-ink">Care plans</h2>
            {counts.pendingApproval > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-medium text-ink">
                {counts.pendingApproval}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Review and approve care plans from your providers.
          </p>
        </Link>
        <Link
          href="/receiver/family"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <h2 className="font-heading font-semibold text-ink">Family circle</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Manage family members involved in your care.
          </p>
        </Link>
        <Link
          href="/receiver/profile"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <h2 className="font-heading font-semibold text-ink">Your profile</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Describe your care needs and preferences.
          </p>
        </Link>
        <Link
          href="/receiver/safeguarding"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <h2 className="font-heading font-semibold text-ink">Safeguarding</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Raise or review safeguarding concerns.
          </p>
        </Link>
        <Link
          href="/receiver/settings/data"
          className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-soft hover:shadow-md transition-shadow duration-300"
        >
          <h2 className="font-heading font-semibold text-ink">Settings</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Data export, privacy, and account settings.
          </p>
        </Link>
      </div>
    </section>
  );
}
