import Link from "next/link";
import { getCompanyProfileWithCatalog } from "@/lib/companies/profile-actions";
import { getCompanyProfile } from "@/lib/companies/queries";
import { getCompanyDocuments } from "@/lib/companies/queries";
import type { CompanyProfileRow } from "@/lib/companies/types";

export const metadata = {
  title: "Company dashboard - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ welcome?: string }>;
};

function profileIsComplete(profile: CompanyProfileRow | null): boolean {
  if (!profile) return false;
  return Boolean(
    profile.company_name && profile.company_number && profile.phone,
  );
}

type ChecklistState = "done" | "missing";

function StatusBadge({ state }: { state: ChecklistState }) {
  const styles: Record<ChecklistState, { label: string; className: string }> = {
    done: { label: "Done", className: "border-success text-success" },
    missing: { label: "Missing", className: "border-border text-ink-muted" },
  };
  const { label, className } = styles[state];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

export default async function CompanyDashboardPage({
  searchParams,
}: PageProps) {
  const { welcome } = await searchParams;
  const [profile, documents, catalog] = await Promise.all([
    getCompanyProfile(),
    getCompanyDocuments(),
    getCompanyProfileWithCatalog(),
  ]);

  const profileDone = profileIsComplete(profile);
  const hasDocuments = documents.length > 0;
  const hasServices = (catalog?.serviceCategoryIds.length ?? 0) > 0;
  const hasCapabilities = (catalog?.capabilityIds.length ?? 0) > 0;

  const checklist = [
    {
      id: "profile",
      label: "Complete your company profile",
      description:
        "Add your Companies House number, registered address, service area, and contact details.",
      href: "/provider/company/profile",
      hrefLabel: profile ? "Edit profile" : "Start profile",
      state: profileDone ? ("done" as const) : ("missing" as const),
    },
    {
      id: "services",
      label: "Select services your company offers",
      description:
        "Choose the service categories that describe what your company provides.",
      href: "/provider/company/services",
      hrefLabel: hasServices ? "Edit services" : "Add services",
      state: hasServices ? ("done" as const) : ("missing" as const),
    },
    {
      id: "capabilities",
      label: "Select specialist capabilities",
      description:
        "Highlight the specialist skills and training your team can deliver.",
      href: "/provider/company/capabilities",
      hrefLabel: hasCapabilities ? "Edit capabilities" : "Add capabilities",
      state: hasCapabilities ? ("done" as const) : ("missing" as const),
    },
    {
      id: "documents",
      label: "Upload company documents",
      description:
        "Insurance certificates, CQC registration, and other company documentation.",
      href: "/provider/company/documents",
      hrefLabel: hasDocuments ? "View documents" : "Upload documents",
      state: hasDocuments ? ("done" as const) : ("missing" as const),
    },
    {
      id: "members",
      label: "Invite team members",
      description:
        "Add individual care providers who work for your company.",
      href: "/provider/company/members",
      hrefLabel: "Manage members",
      state: "missing" as const,
    },
  ];

  const completeCount = checklist.filter((row) => row.state === "done").length;

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          {profile?.company_name ?? "Company dashboard"}
        </h1>
        <p className="text-ink-muted">
          Manage your company profile, documents, and team members.
        </p>
      </header>

      {welcome ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          Welcome! Complete the steps below to get your company verified and
          visible to care receivers.
        </div>
      ) : null}

      {!profile ? (
        <div className="rounded-2xl border border-brand bg-surface p-5">
          <p className="text-sm text-ink">
            You have not set up your company profile yet. This is the first
            thing care receivers will see once your company is verified.
          </p>
          <Link
            href="/provider/company/profile"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Set up company profile
          </Link>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-heading text-lg font-semibold text-ink">Setup checklist</h2>
          <span className="text-sm text-ink-muted" aria-live="polite">
            {completeCount} of {checklist.length} complete
          </span>
        </div>
        <ul className="divide-y divide-border">
          {checklist.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <StatusBadge state={row.state} />
                  <p className="font-medium text-ink">{row.label}</p>
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {row.description}
                </p>
              </div>
              <Link
                href={row.href}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                {row.hrefLabel}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
