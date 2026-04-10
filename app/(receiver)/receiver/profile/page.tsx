import Link from "next/link";
import { redirect } from "next/navigation";

import { Input } from "@/components/ui/input";
import { upsertReceiverProfile } from "@/lib/receivers/actions";
import { getReceiverProfile } from "@/lib/receivers/queries";
import { MOBILITY_LEVEL_LABELS } from "@/lib/receivers/types";
import type { MobilityLevel } from "@/lib/receivers/types";
import { createServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "My care needs - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export default async function ReceiverProfilePage({ searchParams }: PageProps) {
  const { error, saved } = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/sign-in?error=sign-in-required&next=/receiver/profile");
  }

  const profile = await getReceiverProfile();

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          My care needs
        </h1>
        <p className="mt-1 text-ink-muted">
          Tell us about your care requirements. This helps us match you with
          the right providers. Your profile is private and only visible to your
          care circle members.
        </p>
      </header>

      {saved ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          Care needs profile saved.
        </div>
      ) : null}

      {error ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form
        action={upsertReceiverProfile}
        className="space-y-5 rounded-2xl border border-border bg-surface p-6"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="care_needs_summary"
            className="block text-sm font-medium text-ink"
          >
            Care needs summary
          </label>
          <textarea
            id="care_needs_summary"
            name="care_needs_summary"
            rows={4}
            defaultValue={profile?.care_needs_summary ?? ""}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
            aria-describedby="care-needs-hint"
          />
          <p id="care-needs-hint" className="text-xs text-ink-muted">
            Describe your care requirements in your own words.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="preferred_gender"
            className="block text-sm font-medium text-ink"
          >
            Preferred carer gender
          </label>
          <select
            id="preferred_gender"
            name="preferred_gender"
            defaultValue={profile?.preferred_gender ?? ""}
            className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
          >
            <option value="">No preference</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="preferred_schedule"
            className="block text-sm font-medium text-ink"
          >
            Preferred schedule
          </label>
          <Input
            id="preferred_schedule"
            name="preferred_schedule"
            type="text"
            defaultValue={profile?.preferred_schedule ?? ""}
            aria-describedby="schedule-hint"
          />
          <p id="schedule-hint" className="text-xs text-ink-muted">
            E.g. &quot;Mornings only&quot;, &quot;Weekdays 9-5&quot;, &quot;Live-in&quot;
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="mobility_level"
            className="block text-sm font-medium text-ink"
          >
            Mobility level
          </label>
          <select
            id="mobility_level"
            name="mobility_level"
            defaultValue={profile?.mobility_level ?? ""}
            className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
          >
            <option value="">Not specified</option>
            {(
              Object.entries(MOBILITY_LEVEL_LABELS) as [MobilityLevel, string][]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="communication_needs"
            className="block text-sm font-medium text-ink"
          >
            Communication needs
          </label>
          <textarea
            id="communication_needs"
            name="communication_needs"
            rows={3}
            defaultValue={profile?.communication_needs ?? ""}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
            aria-describedby="communication-hint"
          />
          <p id="communication-hint" className="text-xs text-ink-muted">
            E.g. hearing impaired, non-verbal, preferred language.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="dietary_requirements"
            className="block text-sm font-medium text-ink"
          >
            Dietary requirements
          </label>
          <Input
            id="dietary_requirements"
            name="dietary_requirements"
            type="text"
            defaultValue={profile?.dietary_requirements ?? ""}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="medical_conditions_summary"
            className="block text-sm font-medium text-ink"
          >
            Medical conditions (high-level)
          </label>
          <textarea
            id="medical_conditions_summary"
            name="medical_conditions_summary"
            rows={3}
            defaultValue={profile?.medical_conditions_summary ?? ""}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
            aria-describedby="medical-hint"
          />
          <p id="medical-hint" className="text-xs text-ink-muted">
            A brief overview to help providers understand your needs. Not
            detailed medical records.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="postcode"
            className="block text-sm font-medium text-ink"
          >
            Postcode
          </label>
          <Input
            id="postcode"
            name="postcode"
            type="text"
            defaultValue={profile?.postcode ?? ""}
            aria-describedby="postcode-hint"
          />
          <p id="postcode-hint" className="text-xs text-ink-muted">
            Used to help find providers near you. Your exact location is never
            shared.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Save care needs
          </button>
          <Link
            href="/receiver"
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Back to dashboard
          </Link>
        </div>
      </form>
    </section>
  );
}
