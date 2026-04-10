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

export default async function ReceiverCarePlansPage() {
  const plans = await getMyCarePlans();

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
          My care plans
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          View and manage care plans from your providers.
        </p>
      </header>

      {plans.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-ink-muted">
            No care plans yet. Your provider will create one for you.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/receiver/care-plans/${plan.id}`}
                className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-canvas"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{plan.title}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Provider: {plan.provider_name ?? "Unknown"}
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
