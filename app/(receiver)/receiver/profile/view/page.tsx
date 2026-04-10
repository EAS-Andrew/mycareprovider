import Link from "next/link";
import { redirect } from "next/navigation";

import { getReceiverProfile } from "@/lib/receivers/queries";
import { MOBILITY_LEVEL_LABELS } from "@/lib/receivers/types";
import type { MobilityLevel } from "@/lib/receivers/types";
import { createServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "My care needs - MyCareProvider",
};

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink">
        {value || <span className="italic text-ink-muted">Not provided</span>}
      </dd>
    </div>
  );
}

export default async function ReceiverProfileViewPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      "/auth/sign-in?error=sign-in-required&next=/receiver/profile/view",
    );
  }

  const profile = await getReceiverProfile();

  if (!profile) {
    return (
      <section className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
            My care needs
          </h1>
        </header>
        <div className="rounded-2xl border border-brand bg-surface p-5">
          <p className="text-sm text-ink">
            You have not set up your care needs profile yet.
          </p>
          <Link
            href="/receiver/profile"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Set up care needs
          </Link>
        </div>
      </section>
    );
  }

  const mobilityLabel = profile.mobility_level
    ? MOBILITY_LEVEL_LABELS[profile.mobility_level as MobilityLevel] ?? profile.mobility_level
    : null;

  const genderLabel =
    profile.preferred_gender === "female"
      ? "Female"
      : profile.preferred_gender === "male"
        ? "Male"
        : null;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          My care needs
        </h1>
        <Link
          href="/receiver/profile"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Edit
        </Link>
      </header>

      <dl className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <Field label="Care needs summary" value={profile.care_needs_summary} />
        <Field label="Preferred carer gender" value={genderLabel} />
        <Field label="Preferred schedule" value={profile.preferred_schedule} />
        <Field label="Mobility level" value={mobilityLabel} />
        <Field
          label="Communication needs"
          value={profile.communication_needs}
        />
        <Field
          label="Dietary requirements"
          value={profile.dietary_requirements}
        />
        <Field
          label="Medical conditions"
          value={profile.medical_conditions_summary}
        />
        <Field label="Postcode" value={profile.postcode} />
      </dl>

      <Link
        href="/receiver"
        className="text-sm text-ink-muted underline hover:text-ink"
      >
        Back to dashboard
      </Link>
    </section>
  );
}
