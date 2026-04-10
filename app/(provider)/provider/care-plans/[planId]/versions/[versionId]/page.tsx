import Link from "next/link";
import { getCarePlanVersion, getCarePlan } from "@/lib/care-plans/queries";
import { generateCarePlanPdf } from "@/lib/care-plans/pdf";
import {
  FREQUENCY_LABELS,
  VERSION_STATUS_LABELS,
} from "@/lib/care-plans/types";
import type { LineItem } from "@/lib/care-plans/types";

export default async function ProviderVersionDetailPage(props: {
  params: Promise<{ planId: string; versionId: string }>;
}) {
  const { planId, versionId } = await props.params;
  const [versionResult, planResult] = await Promise.all([
    getCarePlanVersion(versionId),
    getCarePlan(planId),
  ]);

  if (!versionResult || !planResult) {
    return (
      <section className="mx-auto max-w-xl py-12 text-center">
        <p className="text-ink-muted">Version not found.</p>
        <Link
          href={`/provider/care-plans/${planId}/versions`}
          className="mt-4 text-sm text-brand"
        >
          Back to version history
        </Link>
      </section>
    );
  }

  const { version, activities } = versionResult;
  const lineItems = version.line_items as LineItem[];
  const formatPence = (pence: number) => `\u00a3${(pence / 100).toFixed(2)}`;

  async function handleExport() {
    "use server";
    const html = await generateCarePlanPdf(versionId, "provider");
    return html;
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/provider/care-plans/${planId}/versions`}
          className="text-sm text-brand hover:underline"
        >
          &larr; Version history
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Version {version.version_number}
          </h1>
          <span className="text-sm text-ink-muted">
            {VERSION_STATUS_LABELS[version.status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Created on{" "}
          {new Date(version.created_at).toLocaleDateString("en-GB")}
        </p>
      </div>

      {version.notes ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Notes</h2>
          <p className="mt-1 text-sm text-ink-muted">{version.notes}</p>
        </div>
      ) : null}

      {version.rejection_reason ? (
        <div className="rounded-md border border-danger bg-danger/10 p-4 text-sm text-danger">
          <strong>Rejection reason:</strong> {version.rejection_reason}
        </div>
      ) : null}

      {/* Activities */}
      {activities.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold text-ink">Activities</h2>
          </div>
          <ul className="divide-y divide-border">
            {activities.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">{a.title}</p>
                  <div className="flex items-center gap-3 text-sm text-ink-muted">
                    <span>{FREQUENCY_LABELS[a.frequency]}</span>
                    {a.duration_minutes ? (
                      <span>{a.duration_minutes} min</span>
                    ) : null}
                  </div>
                </div>
                {a.description ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    {a.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Line items / pricing */}
      {lineItems.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold text-ink">Pricing</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-canvas text-left">
                  <th className="px-5 py-2 font-medium text-ink">
                    Description
                  </th>
                  <th className="px-5 py-2 font-medium text-ink">Unit</th>
                  <th className="px-5 py-2 text-right font-medium text-ink">
                    Qty
                  </th>
                  <th className="px-5 py-2 text-right font-medium text-ink">
                    Unit price
                  </th>
                  <th className="px-5 py-2 text-right font-medium text-ink">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lineItems.map((item, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2 text-ink">{item.description}</td>
                    <td className="px-5 py-2 text-ink-muted">{item.unit}</td>
                    <td className="px-5 py-2 text-right text-ink">
                      {item.quantity}
                    </td>
                    <td className="px-5 py-2 text-right text-ink">
                      {formatPence(item.unit_price_pence)}
                    </td>
                    <td className="px-5 py-2 text-right font-medium text-ink">
                      {formatPence(item.quantity * item.unit_price_pence)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-canvas">
                  <td
                    colSpan={4}
                    className="px-5 py-2 text-right font-semibold text-ink"
                  >
                    Total
                  </td>
                  <td className="px-5 py-2 text-right font-semibold text-ink">
                    {formatPence(version.total_pence)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}

      {/* Consent and approval */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
        <h2 className="font-semibold text-ink">Consent and approval</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-ink-muted">Visit media consent</p>
            <p className="font-medium text-ink">
              {version.visit_media_consent ? "Granted" : "Not granted"}
            </p>
          </div>
          {version.approved_by ? (
            <div>
              <p className="text-ink-muted">Approved on</p>
              <p className="font-medium text-ink">
                {version.approved_at
                  ? new Date(version.approved_at).toLocaleDateString("en-GB")
                  : "-"}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Export */}
      <div className="flex gap-3">
        <form
          action={async () => {
            "use server";
            await handleExport();
          }}
        >
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-md border border-brand px-3 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg"
          >
            Export for print
          </button>
        </form>
      </div>
    </section>
  );
}
