import Link from "next/link";
import { redirect } from "next/navigation";
import { createCarePlanVersion } from "@/lib/care-plans/actions";
import type { ActivityFrequency, LineItem } from "@/lib/care-plans/types";

export default async function NewVersionPage(props: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { planId } = await props.params;
  const searchParams = await props.searchParams;

  async function handleCreate(formData: FormData) {
    "use server";

    // Parse activities from form data
    const activityTitles = formData.getAll("activity_title") as string[];
    const activityDescriptions = formData.getAll(
      "activity_description",
    ) as string[];
    const activityFrequencies = formData.getAll(
      "activity_frequency",
    ) as string[];
    const activityDurations = formData.getAll(
      "activity_duration",
    ) as string[];

    const activities = activityTitles
      .map((title, i) => ({
        title: title.trim(),
        description: activityDescriptions[i]?.trim() || null,
        frequency: (activityFrequencies[i] || "weekly") as ActivityFrequency,
        duration_minutes: activityDurations[i]
          ? parseInt(activityDurations[i], 10) || null
          : null,
        sort_order: i,
      }))
      .filter((a) => a.title.length > 0);

    // Parse line items from form data
    const itemDescriptions = formData.getAll("item_description") as string[];
    const itemUnits = formData.getAll("item_unit") as string[];
    const itemQuantities = formData.getAll("item_quantity") as string[];
    const itemPrices = formData.getAll("item_price") as string[];

    const lineItems: LineItem[] = itemDescriptions
      .map((desc, i) => ({
        description: desc.trim(),
        unit: itemUnits[i]?.trim() || "hour",
        quantity: parseFloat(itemQuantities[i]) || 0,
        unit_price_pence: Math.round(
          (parseFloat(itemPrices[i]) || 0) * 100,
        ),
      }))
      .filter((item) => item.description.length > 0 && item.quantity > 0);

    const notes = (formData.get("notes") as string)?.trim() || undefined;

    try {
      await createCarePlanVersion({
        carePlanId: planId,
        activities,
        lineItems,
        notes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create version";
      redirect(
        `/provider/care-plans/${planId}/versions/new?error=${encodeURIComponent(msg)}`,
      );
    }
    redirect(`/provider/care-plans/${planId}`);
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/provider/care-plans/${planId}`}
          className="text-sm text-brand hover:underline"
        >
          &larr; Back to care plan
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-ink">
          Create new version
        </h1>
      </div>

      {searchParams.error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger bg-danger/10 p-4 text-sm text-danger"
        >
          {searchParams.error}
        </div>
      ) : null}

      <form action={handleCreate} className="space-y-8">
        {/* Activities section */}
        <fieldset className="rounded-2xl border border-border bg-surface p-5">
          <legend className="px-2 text-lg font-semibold text-ink">
            Activities
          </legend>
          <p className="mb-4 text-sm text-ink-muted">
            Add care activities included in this version. You can add more rows
            as needed.
          </p>

          <div className="space-y-4" id="activities">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Activity title
                  </label>
                  <input
                    name="activity_title"
                    type="text"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    placeholder="e.g. Morning personal care"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Frequency
                  </label>
                  <select
                    name="activity_frequency"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                    <option value="as_needed">As needed</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Description (optional)
                  </label>
                  <input
                    name="activity_description"
                    type="text"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    placeholder="Details about this activity"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Duration (minutes)
                  </label>
                  <input
                    name="activity_duration"
                    type="number"
                    min="1"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    placeholder="30"
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            To add more activities, duplicate the fields above before
            submitting. Dynamic add/remove will be added in a future update.
          </p>
        </fieldset>

        {/* Line items section */}
        <fieldset className="rounded-2xl border border-border bg-surface p-5">
          <legend className="px-2 text-lg font-semibold text-ink">
            Pricing
          </legend>
          <p className="mb-4 text-sm text-ink-muted">
            Add line items with transparent per-item pricing.
          </p>

          <div className="space-y-4" id="line-items">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Description
                  </label>
                  <input
                    name="item_description"
                    type="text"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    placeholder="e.g. Personal care visit"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Unit
                  </label>
                  <input
                    name="item_unit"
                    type="text"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    placeholder="hour"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Quantity
                  </label>
                  <input
                    name="item_quantity"
                    type="number"
                    min="0"
                    step="0.5"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    placeholder="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink">
                    Unit price (GBP)
                  </label>
                  <input
                    name="item_price"
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    placeholder="15.00"
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            Prices are entered in pounds. To add more line items, duplicate the
            fields above.
          </p>
        </fieldset>

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-ink">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="mt-1 block w-full rounded-xl border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
            placeholder="Any additional notes for this version..."
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Create version
          </button>
          <Link
            href={`/provider/care-plans/${planId}`}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-ink transition-colors hover:bg-canvas"
          >
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
