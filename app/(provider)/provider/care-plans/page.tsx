import Link from "next/link";
import { getMyCarePlans } from "@/lib/care-plans/queries";
import { CARE_PLAN_STATUS_LABELS } from "@/lib/care-plans/types";
import type { CarePlanStatus } from "@/lib/care-plans/types";

const STATUS_STYLES: Record<CarePlanStatus, string> = {
  draft: "border-border text-ink-muted",
  pending_approval: "border-warning text-warning",
  active: "border-success text-success",
  paused: "border-warning text-warning",
  completed: "border-border text-ink-muted",
  cancelled: "border-danger text-danger",
};

export default async function ProviderCarePlansPage() {
  const plans = await getMyCarePlans();

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
            Care plans
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Manage care plans for your clients.
          </p>
        </div>
        <Link
          href="/provider/care-plans/new"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          New care plan
        </Link>
      </header>

      {plans.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-ink-muted">
            You have not created any care plans yet.
          </p>
          <Link
            href="/provider/care-plans/new"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Create your first care plan
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/provider/care-plans/${plan.id}`}
                className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-canvas"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{plan.title}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Receiver: {plan.receiver_name ?? "Unknown"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[plan.status]}`}
                  >
                    {CARE_PLAN_STATUS_LABELS[plan.status]}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {new Date(plan.updated_at).toLocaleDateString("en-GB")}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
