import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import {
  getPendingSafeguardingReports,
  getSafeguardingStats,
} from "@/lib/safeguarding/queries";
import { SEVERITY_LABELS, STATUS_LABELS } from "@/lib/safeguarding/types";

export const metadata: Metadata = {
  title: "Safeguarding - Administrator",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function AdminSafeguardingPage({
  searchParams,
}: PageProps) {
  const { error, ok } = await searchParams;
  const [reports, stats] = await Promise.all([
    getPendingSafeguardingReports(),
    getSafeguardingStats(),
  ]);

  return (
    <section className="mx-auto max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight">Safeguarding</h1>
      <p className="mt-1 text-ink-muted">
        Triage, investigate, and resolve safeguarding reports. 24-hour SLA for
        medium severity and above.
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {ok ? (
        <div
          role="status"
          className="mt-4 rounded-md border border-success bg-canvas p-3 text-sm text-ink"
        >
          {ok}
        </div>
      ) : null}

      {/* Stats summary */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Submitted" value={stats.submitted} />
        <StatCard label="Triaged" value={stats.triaged} />
        <StatCard label="Investigating" value={stats.investigating} />
        <StatCard label="Escalated" value={stats.escalated} />
        <StatCard
          label="Overdue triage"
          value={stats.overdueTriage}
          alert={stats.overdueTriage > 0}
        />
      </div>

      {/* Active reports queue */}
      <h2 className="mt-10 text-xl font-semibold">Active reports</h2>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Date
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Summary
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Severity
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Triage by
              </th>
              <th scope="col" className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-ink-muted">
                  No active safeguarding reports.
                </td>
              </tr>
            ) : (
              reports.map((r) => {
                const isOverdue =
                  r.triage_deadline &&
                  r.status === "submitted" &&
                  new Date(r.triage_deadline) < new Date();
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(r.created_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-ink">
                      {r.summary}
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={r.severity} />
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {STATUS_LABELS[r.status]}
                    </td>
                    <td className="px-4 py-3">
                      {r.triage_deadline ? (
                        <span
                          className={
                            isOverdue
                              ? "font-medium text-danger"
                              : "text-ink-muted"
                          }
                        >
                          {new Date(r.triage_deadline).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {isOverdue ? " OVERDUE" : ""}
                        </span>
                      ) : (
                        <span className="text-ink-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/safeguarding/${r.id}`}
                        className={buttonStyles({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${alert ? "border-danger bg-red-50" : "border-border"}`}
    >
      <p className="text-sm text-ink-muted">{label}</p>
      <p
        className={`text-2xl font-semibold tabular-nums ${alert ? "text-danger" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    information: "bg-surface text-ink-muted",
    low: "bg-surface text-ink-muted",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-orange-100 text-orange-800",
    immediate_risk: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[severity] ?? "bg-surface text-ink-muted"}`}
    >
      {SEVERITY_LABELS[severity as keyof typeof SEVERITY_LABELS] ?? severity}
    </span>
  );
}
