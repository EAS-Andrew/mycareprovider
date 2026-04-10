import Link from "next/link";
import { redirect } from "next/navigation";
import { getCarePlan } from "@/lib/care-plans/queries";
import {
  submitForApproval,
  pauseCarePlan,
  resumeCarePlan,
  completeCarePlan,
  cancelCarePlan,
} from "@/lib/care-plans/actions";
import {
  CARE_PLAN_STATUS_LABELS,
  VERSION_STATUS_LABELS,
} from "@/lib/care-plans/types";

export default async function ProviderCarePlanDetailPage(props: {
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
        <Link href="/provider/care-plans" className="mt-4 text-sm text-brand">
          Back to care plans
        </Link>
      </section>
    );
  }

  const { plan, latestVersion } = result;

  async function handleSubmit() {
    "use server";
    if (!latestVersion) return;
    try {
      await submitForApproval(latestVersion.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit";
      redirect(
        `/provider/care-plans/${planId}?error=${encodeURIComponent(msg)}`,
      );
    }
    redirect(`/provider/care-plans/${planId}`);
  }

  async function handlePause() {
    "use server";
    await pauseCarePlan(planId);
    redirect(`/provider/care-plans/${planId}`);
  }

  async function handleResume() {
    "use server";
    await resumeCarePlan(planId);
    redirect(`/provider/care-plans/${planId}`);
  }

  async function handleComplete() {
    "use server";
    await completeCarePlan(planId);
    redirect(`/provider/care-plans/${planId}`);
  }

  async function handleCancel() {
    "use server";
    await cancelCarePlan(planId);
    redirect(`/provider/care-plans/${planId}`);
  }

  const formatPence = (pence: number) => `\u00a3${(pence / 100).toFixed(2)}`;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/provider/care-plans"
            className="text-sm text-brand hover:underline"
          >
            &larr; Care plans
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            {plan.title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Receiver: {plan.receiver_name ?? "Unknown"}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium">
          {CARE_PLAN_STATUS_LABELS[plan.status]}
        </span>
      </div>

      {searchParams.error ? (
        <div
          role="alert"
          className="rounded-md border border-danger bg-danger/10 p-4 text-sm text-danger"
        >
          {searchParams.error}
        </div>
      ) : null}

      {/* Latest version summary */}
      {latestVersion ? (
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">
              Version {latestVersion.version_number}
            </h2>
            <span className="text-sm text-ink-muted">
              {VERSION_STATUS_LABELS[latestVersion.status]}
            </span>
          </div>
          {latestVersion.notes ? (
            <p className="mt-2 text-sm text-ink-muted">{latestVersion.notes}</p>
          ) : null}
          <div className="mt-3 flex items-center gap-4 text-sm text-ink-muted">
            <span>
              {latestVersion.line_items.length} line{" "}
              {latestVersion.line_items.length === 1 ? "item" : "items"}
            </span>
            <span>Total: {formatPence(latestVersion.total_pence)}</span>
            <span>
              Created:{" "}
              {new Date(latestVersion.created_at).toLocaleDateString("en-GB")}
            </span>
          </div>
          {latestVersion.rejection_reason ? (
            <div className="mt-3 rounded-md border border-danger bg-danger/10 p-3 text-sm text-danger">
              <strong>Rejected:</strong> {latestVersion.rejection_reason}
            </div>
          ) : null}
          <div className="mt-4 flex gap-3">
            <Link
              href={`/provider/care-plans/${planId}/versions/${latestVersion.id}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-brand px-3 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg"
            >
              View details
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-ink-muted">No versions created yet.</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/provider/care-plans/${planId}/versions/new`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Create new version
        </Link>

        {latestVersion?.status === "draft" && plan.status === "draft" ? (
          <form action={handleSubmit}>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg"
            >
              Submit for approval
            </button>
          </form>
        ) : null}

        {plan.status === "active" ? (
          <>
            <form action={handlePause}>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-md border border-warning px-4 text-sm font-medium text-warning transition-colors hover:bg-warning hover:text-white"
              >
                Pause
              </button>
            </form>
            <form action={handleComplete}>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-md border border-success px-4 text-sm font-medium text-success transition-colors hover:bg-success hover:text-white"
              >
                Complete
              </button>
            </form>
          </>
        ) : null}

        {plan.status === "paused" ? (
          <form action={handleResume}>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg"
            >
              Resume
            </button>
          </form>
        ) : null}

        {plan.status !== "cancelled" && plan.status !== "completed" ? (
          <form action={handleCancel}>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md border border-danger px-4 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white"
            >
              Cancel plan
            </button>
          </form>
        ) : null}
      </div>

      {/* Version history link */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink">Version history</h2>
        <p className="mt-1 text-sm text-ink-muted">
          View all previous versions and track changes over time.
        </p>
        <Link
          href={`/provider/care-plans/${planId}/versions`}
          className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-brand px-3 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg"
        >
          View version history
        </Link>
      </div>
    </section>
  );
}
