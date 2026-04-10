import type { Metadata } from "next";
import Link from "next/link";
import { submitSafeguardingReport } from "@/lib/safeguarding/actions";
import { getMySafeguardingReports } from "@/lib/safeguarding/queries";
import { SEVERITY_LABELS, STATUS_LABELS } from "@/lib/safeguarding/types";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Safeguarding - Care Receiver",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function ReceiverSafeguardingPage({
  searchParams,
}: PageProps) {
  const { error, ok } = await searchParams;
  const myReports = await getMySafeguardingReports();

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">
        Safeguarding
      </h1>
      <p className="mt-1 text-ink-muted">
        Report a concern about the safety or wellbeing of yourself or someone
        you know. This is a confidential channel, separate from general
        complaints.
      </p>

      <div className="mt-4 rounded-md border border-border bg-surface p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">
          What is a safeguarding concern?
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Suspected abuse, neglect, or risk of harm</li>
          <li>Concerns about a care provider&apos;s conduct</li>
          <li>Situations where someone may be at immediate risk</li>
        </ul>
      </div>

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

      <form action={submitSafeguardingReport} className="mt-8 space-y-6">
        <div className="space-y-2">
          <label
            htmlFor="subjectType"
            className="block text-sm font-medium text-ink"
          >
            Who is the concern about?
          </label>
          <select
            id="subjectType"
            name="subjectType"
            required
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <option value="">Select...</option>
            <option value="provider">A care provider</option>
            <option value="receiver">A care receiver</option>
            <option value="other">Other / not sure</option>
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="subjectDescription"
            className="block text-sm font-medium text-ink"
          >
            Name or description of the person (if known)
          </label>
          <input
            type="text"
            id="subjectDescription"
            name="subjectDescription"
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            placeholder="Optional"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="severity"
            className="block text-sm font-medium text-ink"
          >
            How urgent is this concern?
          </label>
          <select
            id="severity"
            name="severity"
            required
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <option value="information">Information only</option>
            <option value="low">Low</option>
            <option value="medium">Medium - needs attention within 24 hours</option>
            <option value="high">High - significant risk</option>
            <option value="immediate_risk">Immediate risk</option>
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="summary"
            className="block text-sm font-medium text-ink"
          >
            Brief summary
          </label>
          <input
            type="text"
            id="summary"
            name="summary"
            required
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            placeholder="A short description of your concern"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="details"
            className="block text-sm font-medium text-ink"
          >
            Full details
          </label>
          <textarea
            id="details"
            name="details"
            rows={5}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            placeholder="Include as much detail as possible"
          />
        </div>

        <Button type="submit">Submit safeguarding report</Button>
      </form>

      {myReports.length > 0 ? (
        <div className="mt-12">
          <h2 className="text-xl font-semibold">Your previous reports</h2>
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
                </tr>
              </thead>
              <tbody>
                {myReports.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(r.created_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-3 text-ink">{r.summary}</td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={r.severity} />
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {STATUS_LABELS[r.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-8 rounded-md border border-border bg-surface p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">In an emergency</p>
        <p className="mt-1">
          If someone is in immediate danger, call 999.
        </p>
      </div>
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
