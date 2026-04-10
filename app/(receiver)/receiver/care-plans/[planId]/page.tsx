import Link from "next/link";
import { redirect } from "next/navigation";
import { getCarePlan } from "@/lib/care-plans/queries";
import { approveCarePlan, rejectCarePlan } from "@/lib/care-plans/actions";
import {
  CARE_PLAN_STATUS_LABELS,
  VERSION_STATUS_LABELS,
} from "@/lib/care-plans/types";
import type { LineItem } from "@/lib/care-plans/types";

export default async function ReceiverCarePlanDetailPage(props: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { planId } = await props.params;
  const searchParams = await props.searchParams;
  const result = await getCarePlan(planId);

  if (!result) {
    return (
      <section className="mx-auto max-w-xl py-12 text-center">
        <p className="text-ink-muted">Care plan not found.</p>
        <Link href="/receiver/care-plans" className="mt-4 text-sm text-brand">
          Back to care plans
        </Link>
      </section>
    );
  }

  const { plan, latestVersion } = result;
  const formatPence = (pence: number) => `\u00a3${(pence / 100).toFixed(2)}`;

  const isPending =
    latestVersion?.status === "submitted" &&
    plan.status === "pending_approval";

  async function handleApprove(formData: FormData) {
    "use server";
    if (!latestVersion) return;
    const consent = formData.get("visit_media_consent") === "on";
    try {
      await approveCarePlan(latestVersion.id, consent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to approve";
      redirect(
        `/receiver/care-plans/${planId}?error=${encodeURIComponent(msg)}`,
      );
    }
    redirect(`/receiver/care-plans/${planId}`);
  }

  async function handleReject(formData: FormData) {
    "use server";
    if (!latestVersion) return;
    const reason = formData.get("rejection_reason") as string;
    try {
      await rejectCarePlan(latestVersion.id, reason);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reject";
      redirect(
        `/receiver/care-plans/${planId}?error=${encodeURIComponent(msg)}`,
      );
    }
    redirect(`/receiver/care-plans/${planId}`);
  }

  const lineItems = (latestVersion?.line_items ?? []) as LineItem[];

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/receiver/care-plans"
            className="text-sm text-brand hover:underline"
          >
            &larr; Care plans
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-ink">
            {plan.title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Provider: {plan.provider_name ?? "Unknown"}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium">
          {CARE_PLAN_STATUS_LABELS[plan.status]}
        </span>
      </div>

      {searchParams.error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger bg-danger/10 p-4 text-sm text-danger"
        >
          {searchParams.error}
        </div>
      ) : null}

      {/* Latest version */}
      {latestVersion ? (
        <div className="rounded-2xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold text-ink">
              Version {latestVersion.version_number}
            </h2>
            <span className="text-sm text-ink-muted">
              {VERSION_STATUS_LABELS[latestVersion.status]}
            </span>
          </div>

          {latestVersion.notes ? (
            <p className="text-sm text-ink-muted">{latestVersion.notes}</p>
          ) : null}

          {/* Line items table */}
          {lineItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-canvas text-left">
                    <th className="px-4 py-2 font-medium text-ink">
                      Description
                    </th>
                    <th className="px-4 py-2 font-medium text-ink">Unit</th>
                    <th className="px-4 py-2 text-right font-medium text-ink">
                      Qty
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-ink">
                      Unit price
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-ink">
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineItems.map((item, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-ink">
                        {item.description}
                      </td>
                      <td className="px-4 py-2 text-ink-muted">{item.unit}</td>
                      <td className="px-4 py-2 text-right text-ink">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-2 text-right text-ink">
                        {formatPence(item.unit_price_pence)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-ink">
                        {formatPence(item.quantity * item.unit_price_pence)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-canvas">
                    <td
                      colSpan={4}
                      className="px-4 py-2 text-right font-semibold text-ink"
                    >
                      Total
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-ink">
                      {formatPence(latestVersion.total_pence)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}

          <Link
            href={`/receiver/care-plans/${planId}/versions/${latestVersion.id}`}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-brand px-3 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg"
          >
            View full details
          </Link>
        </div>
      ) : null}

      {/* Approval flow */}
      {isPending && latestVersion ? (
        <div className="rounded-2xl border-2 border-brand bg-surface p-6 space-y-6">
          <h2 className="font-heading text-lg font-semibold text-ink">
            Review and approve this care plan
          </h2>

          <p className="text-sm text-ink-muted">
            Please review the activities and pricing above carefully before
            approving or rejecting.
          </p>

          {/* Approve form */}
          <form action={handleApprove} className="space-y-4">
            <div className="rounded-xl border border-border p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="visit_media_consent"
                  className="mt-1 h-4 w-4 rounded border-border text-brand focus:ring-brand-ring"
                />
                <span className="text-sm text-ink">
                  <strong>Visit media consent:</strong> I consent to the care
                  provider capturing photos or video during visits under this
                  care plan. This consent is recorded on this version and cannot
                  be changed without approving a new version.
                </span>
              </label>
            </div>

            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-success px-4 text-sm font-medium text-white transition-colors hover:bg-success/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              Approve care plan
            </button>
          </form>

          <hr className="border-border" />

          {/* Reject form */}
          <form action={handleReject} className="space-y-3">
            <div>
              <label
                htmlFor="rejection_reason"
                className="block text-sm font-medium text-ink"
              >
                Reason for rejection
              </label>
              <textarea
                id="rejection_reason"
                name="rejection_reason"
                rows={2}
                required
                className="mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                placeholder="Please explain why you are rejecting this care plan..."
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-danger px-4 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              Reject care plan
            </button>
          </form>
        </div>
      ) : null}

      {/* Version history link */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-ink">Version history</h2>
        <p className="mt-1 text-sm text-ink-muted">
          View all previous versions and track changes.
        </p>
        <Link
          href={`/receiver/care-plans/${planId}/versions`}
          className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-brand px-3 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg"
        >
          View version history
        </Link>
      </div>
    </section>
  );
}
