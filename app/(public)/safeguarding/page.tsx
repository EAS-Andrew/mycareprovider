import type { Metadata } from "next";
import { submitSafeguardingReport } from "@/lib/safeguarding/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Report a Safeguarding Concern - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function PublicSafeguardingPage({
  searchParams,
}: PageProps) {
  const { error, ok } = await searchParams;

  return (
    <section className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Report a safeguarding concern
      </h1>
      <p className="mt-2 text-ink-muted">
        Use this form to report a concern about the safety or wellbeing of a
        person receiving care. This is a confidential channel and is separate
        from general complaints or service feedback.
      </p>

      <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">
          What is a safeguarding concern?
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Suspected abuse, neglect, or risk of harm to a vulnerable person</li>
          <li>Concerns about a care provider&apos;s conduct or fitness to practise</li>
          <li>Situations where someone may be at immediate risk</li>
        </ul>
        <p className="mt-3">
          If you have a complaint about the quality of a service (not a safety
          concern), please use the general feedback channel instead.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {ok ? (
        <div
          role="status"
          className="mt-6 rounded-xl border border-success bg-canvas p-4 text-sm text-ink"
        >
          <p className="font-medium">Your report has been submitted.</p>
          <p className="mt-1 text-ink-muted">
            A safeguarding reviewer will assess your report. If you provided
            contact details, you may be contacted for further information.
          </p>
        </div>
      ) : (
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
              <option value="information">
                Information only - no immediate risk
              </option>
              <option value="low">Low - minor concern</option>
              <option value="medium">Medium - needs attention within 24 hours</option>
              <option value="high">High - significant risk of harm</option>
              <option value="immediate_risk">
                Immediate risk - someone is in danger now
              </option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="summary"
              className="block text-sm font-medium text-ink"
            >
              Brief summary of your concern
            </label>
            <input
              type="text"
              id="summary"
              name="summary"
              required
              className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              placeholder="A short description of what happened or what you are concerned about"
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
              placeholder="Include as much detail as possible: what happened, when, where, who was involved, any witnesses"
            />
          </div>

          <div className="rounded-xl border border-border bg-surface p-3 text-sm text-ink-muted">
            You are submitting this report anonymously. If you are signed in,
            your identity will be recorded confidentially but will not be shared
            with the subject of the report.
          </div>

          <Button type="submit">Submit safeguarding report</Button>
        </form>
      )}

      <div className="mt-8 rounded-xl border border-border bg-surface p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">In an emergency</p>
        <p className="mt-1">
          If someone is in immediate danger, call 999. You can also contact
          your local authority adult safeguarding team directly.
        </p>
      </div>
    </section>
  );
}
