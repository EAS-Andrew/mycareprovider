import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  triageReport,
  addReportEvent,
  escalateReport,
  resolveReport,
} from "@/lib/safeguarding/actions";
import { getSafeguardingReport } from "@/lib/safeguarding/queries";
import {
  SEVERITY_LABELS,
  STATUS_LABELS,
  EVENT_TYPE_LABELS,
} from "@/lib/safeguarding/types";

export const metadata: Metadata = {
  title: "Review Safeguarding Report - Administrator",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function SafeguardingReviewPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error, ok } = await searchParams;

  const result = await getSafeguardingReport(id);
  if (!result) notFound();

  const { report, events } = result;

  const isOverdue =
    report.triage_deadline &&
    report.status === "submitted" &&
    new Date(report.triage_deadline) < new Date();

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/safeguarding"
          className="text-sm text-ink-muted underline"
        >
          &larr; Back to safeguarding queue
        </Link>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">
        Safeguarding report
      </h1>

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

      {isOverdue ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-danger bg-red-50 p-3 text-sm font-medium text-danger"
        >
          OVERDUE: This report has not been triaged within the 24-hour SLA.
        </div>
      ) : null}

      {/* Report details */}
      <div className="mt-6 rounded-lg border border-border p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="font-medium text-ink-muted">Status</dt>
          <dd className="text-ink">
            <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium">
              {STATUS_LABELS[report.status]}
            </span>
          </dd>
          <dt className="font-medium text-ink-muted">Severity</dt>
          <dd>
            <SeverityBadge severity={report.severity} />
          </dd>
          <dt className="font-medium text-ink-muted">Subject type</dt>
          <dd className="text-ink capitalize">{report.subject_type}</dd>
          {report.subject_description ? (
            <>
              <dt className="font-medium text-ink-muted">Subject description</dt>
              <dd className="text-ink">{report.subject_description}</dd>
            </>
          ) : null}
          <dt className="font-medium text-ink-muted">Reporter</dt>
          <dd className="text-ink">
            {report.reporter_id
              ? `${report.reporter_role ?? "authenticated"} (${report.reporter_id.slice(0, 8)}...)`
              : "Anonymous"}
          </dd>
          <dt className="font-medium text-ink-muted">Submitted</dt>
          <dd className="text-ink">
            {new Date(report.created_at).toLocaleString("en-GB")}
          </dd>
          {report.triage_deadline ? (
            <>
              <dt className="font-medium text-ink-muted">Triage deadline</dt>
              <dd className={isOverdue ? "font-medium text-danger" : "text-ink"}>
                {new Date(report.triage_deadline).toLocaleString("en-GB")}
                {isOverdue ? " (OVERDUE)" : ""}
              </dd>
            </>
          ) : null}
          {report.assigned_to ? (
            <>
              <dt className="font-medium text-ink-muted">Assigned to</dt>
              <dd className="text-ink">{report.assigned_to.slice(0, 8)}...</dd>
            </>
          ) : null}
        </dl>
      </div>

      {/* Summary and details */}
      <div className="mt-6 rounded-lg border border-border p-5">
        <h2 className="mb-2 text-lg font-semibold">Summary</h2>
        <p className="text-sm text-ink">{report.summary}</p>
        {report.details ? (
          <>
            <h2 className="mb-2 mt-4 text-lg font-semibold">Details</h2>
            <p className="whitespace-pre-wrap text-sm text-ink">
              {report.details}
            </p>
          </>
        ) : null}
      </div>

      {/* Events timeline */}
      <div className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Timeline</h2>
        {events.length === 0 ? (
          <p className="text-sm text-ink-muted">No events recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {events.map((e) => (
              <div
                key={e.id}
                className="rounded-lg border border-border p-4 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-ink">
                    {EVENT_TYPE_LABELS[e.event_type]}
                  </span>
                  <span className="text-ink-muted">
                    {new Date(e.created_at).toLocaleString("en-GB")}
                  </span>
                </div>
                {e.details ? (
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-ink-muted">
                    {JSON.stringify(e.details, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action forms */}
      {report.status !== "resolved" ? (
        <div className="mt-8 space-y-8">
          {/* Triage form */}
          {report.status === "submitted" ? (
            <div className="rounded-lg border border-border p-5">
              <h2 className="mb-3 text-lg font-semibold">Triage</h2>
              <form action={triageReport} className="space-y-4">
                <input type="hidden" name="reportId" value={report.id} />
                <div className="space-y-2">
                  <label
                    htmlFor="severity"
                    className="block text-sm font-medium text-ink"
                  >
                    Confirm severity
                  </label>
                  <select
                    id="severity"
                    name="severity"
                    defaultValue={report.severity}
                    className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                  >
                    <option value="information">Information</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="immediate_risk">Immediate risk</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="triage-assignedTo"
                    className="block text-sm font-medium text-ink"
                  >
                    Assign to reviewer (profile ID)
                  </label>
                  <input
                    type="text"
                    id="triage-assignedTo"
                    name="assignedTo"
                    className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                    placeholder="Optional - admin profile UUID"
                  />
                </div>
                <Button type="submit">Triage report</Button>
              </form>
            </div>
          ) : null}

          {/* Add note */}
          <div className="rounded-lg border border-border p-5">
            <h2 className="mb-3 text-lg font-semibold">Add note</h2>
            <form action={addReportEvent} className="space-y-4">
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="eventType" value="note" />
              <div className="space-y-2">
                <label
                  htmlFor="notes"
                  className="block text-sm font-medium text-ink"
                >
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  required
                  className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                  placeholder="Investigation notes, observations, actions taken"
                />
              </div>
              <Button type="submit" variant="outline">
                Add note
              </Button>
            </form>
          </div>

          {/* Escalate */}
          <div className="rounded-lg border border-border p-5">
            <h2 className="mb-3 text-lg font-semibold">
              Statutory escalation
            </h2>
            <p className="mb-4 text-sm text-ink-muted">
              Record an escalation to a statutory body (local authority adult
              safeguarding board, police, CQC).
            </p>
            <form action={escalateReport} className="space-y-4">
              <input type="hidden" name="reportId" value={report.id} />
              <div className="space-y-2">
                <label
                  htmlFor="escalationTarget"
                  className="block text-sm font-medium text-ink"
                >
                  Escalation target
                </label>
                <select
                  id="escalationTarget"
                  name="escalationTarget"
                  required
                  className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                >
                  <option value="">Select...</option>
                  <option value="local_authority_safeguarding_board">
                    Local authority adult safeguarding board
                  </option>
                  <option value="police">Police</option>
                  <option value="cqc">CQC</option>
                  <option value="other">Other statutory body</option>
                </select>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="justification"
                  className="block text-sm font-medium text-ink"
                >
                  Justification
                </label>
                <textarea
                  id="justification"
                  name="justification"
                  rows={3}
                  required
                  className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                  placeholder="Reason for statutory escalation"
                />
              </div>
              <Button type="submit">Record escalation</Button>
            </form>
          </div>

          {/* Resolve */}
          <div className="rounded-lg border border-border p-5">
            <h2 className="mb-3 text-lg font-semibold">Resolve</h2>
            <form action={resolveReport} className="space-y-4">
              <input type="hidden" name="reportId" value={report.id} />
              <div className="space-y-2">
                <label
                  htmlFor="resolutionNotes"
                  className="block text-sm font-medium text-ink"
                >
                  Resolution notes
                </label>
                <textarea
                  id="resolutionNotes"
                  name="resolutionNotes"
                  rows={3}
                  required
                  className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                  placeholder="How was this report resolved?"
                />
              </div>
              <Button type="submit" variant="outline">
                Resolve report
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
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
