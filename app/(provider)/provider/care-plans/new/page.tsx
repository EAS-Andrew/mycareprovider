import { redirect } from "next/navigation";
import { createCarePlan } from "@/lib/care-plans/actions";
import { createServerClient } from "@/lib/supabase/server";

export default async function NewCarePlanPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only show receivers who have an accepted contact request with this provider.
  const { data: acceptedContacts } = await supabase
    .from("contact_requests")
    .select("receiver_id, profiles!contact_requests_receiver_id_fkey(id, display_name)")
    .eq("provider_id", user?.id ?? "")
    .eq("status", "accepted")
    .is("deleted_at", null);

  const seen = new Set<string>();
  const receivers: { id: string; display_name: string | null }[] = [];
  for (const c of acceptedContacts ?? []) {
    // The FK join returns a single object (not an array) for a belongs-to relation,
    // but Supabase types it loosely. Cast through unknown to satisfy strict TS.
    const profile = c.profiles as unknown as { id: string; display_name: string | null } | null;
    if (profile && !seen.has(profile.id)) {
      seen.add(profile.id);
      receivers.push({ id: profile.id, display_name: profile.display_name });
    }
  }
  receivers.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));

  async function handleCreate(formData: FormData) {
    "use server";
    const title = formData.get("title") as string;
    const receiverId = formData.get("receiver_id") as string;
    let planId: string;
    try {
      planId = await createCarePlan(title, receiverId);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create care plan";
      redirect(`/provider/care-plans/new?error=${encodeURIComponent(msg)}`);
    }
    redirect(`/provider/care-plans/${planId}`);
  }

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
        New care plan
      </h1>

      {searchParams.error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger bg-danger/10 p-4 text-sm text-danger"
        >
          {searchParams.error}
        </div>
      ) : null}

      {receivers.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-ink-muted">
            You do not have any accepted contact requests yet. A care receiver
            must contact you and you must accept before you can create a care
            plan for them.
          </p>
          <a
            href="/provider/contacts"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            View contact requests
          </a>
        </div>
      ) : null}

      <form action={handleCreate} className={`space-y-4${receivers.length === 0 ? " hidden" : ""}`}>
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-ink"
          >
            Care plan title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
            placeholder="e.g. Daily personal care"
          />
        </div>

        <div>
          <label
            htmlFor="receiver_id"
            className="block text-sm font-medium text-ink"
          >
            Care receiver
          </label>
          <select
            id="receiver_id"
            name="receiver_id"
            required
            className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
          >
            <option value="">Select a receiver</option>
            {receivers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name ?? "Unnamed receiver"}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Create care plan
          </button>
          <a
            href="/provider/care-plans"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-ink transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
