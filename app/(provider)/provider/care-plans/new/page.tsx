import { redirect } from "next/navigation";
import { createCarePlan } from "@/lib/care-plans/actions";
import { createServerClient } from "@/lib/supabase/server";

export default async function NewCarePlanPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();

  // Fetch receivers with accepted contact relationships.
  // For now, fetch all receiver profiles visible to this provider via RLS.
  const { data: receivers } = await supabase
    .from("profiles")
    .select("id, display_name, role")
    .eq("role", "receiver")
    .is("deleted_at", null)
    .order("display_name", { ascending: true });

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
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        New care plan
      </h1>

      {searchParams.error ? (
        <div
          role="alert"
          className="rounded-md border border-danger bg-danger/10 p-4 text-sm text-danger"
        >
          {searchParams.error}
        </div>
      ) : null}

      <form action={handleCreate} className="space-y-4">
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
            className="mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
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
            className="mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
          >
            <option value="">Select a receiver</option>
            {((receivers ?? []) as { id: string; display_name: string | null }[]).map(
              (r) => (
                <option key={r.id} value={r.id}>
                  {r.display_name ?? "Unnamed receiver"}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Create care plan
          </button>
          <a
            href="/provider/care-plans"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-ink transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
