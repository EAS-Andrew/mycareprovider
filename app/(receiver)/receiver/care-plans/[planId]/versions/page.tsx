import Link from "next/link";
import { getCarePlanVersions } from "@/lib/care-plans/queries";
import { VERSION_STATUS_LABELS } from "@/lib/care-plans/types";

export default async function ReceiverVersionHistoryPage(props: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await props.params;
  const versions = await getCarePlanVersions(planId);

  const formatPence = (pence: number) => `\u00a3${(pence / 100).toFixed(2)}`;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/receiver/care-plans/${planId}`}
          className="text-sm text-brand hover:underline"
        >
          &larr; Back to care plan
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-ink">
          Version history
        </h1>
      </div>

      {versions.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-ink-muted">No versions yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {versions.map((v) => (
            <li key={v.id}>
              <Link
                href={`/receiver/care-plans/${planId}/versions/${v.id}`}
                className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-canvas"
              >
                <div>
                  <p className="font-medium text-ink">
                    Version {v.version_number}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatPence(v.total_pence)} -{" "}
                    {new Date(v.created_at).toLocaleDateString("en-GB")}
                  </p>
                  {v.notes ? (
                    <p className="mt-1 text-sm text-ink-muted">{v.notes}</p>
                  ) : null}
                </div>
                <span className="text-sm text-ink-muted">
                  {VERSION_STATUS_LABELS[v.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
