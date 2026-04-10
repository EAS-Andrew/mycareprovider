import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { getVerificationStats } from "@/lib/admin/verification-queries";

export const metadata = {
  title: "Verification - Administrator",
};

export default async function VerificationDashboardPage() {
  const stats = await getVerificationStats();

  const queues = [
    {
      label: "Provider documents",
      count: stats.pendingDocuments,
      href: "/admin/verification/providers",
      description: "DBS checks, insurance, certifications, and identity documents awaiting review",
    },
    {
      label: "Providers",
      count: stats.pendingProviders,
      href: "/admin/verification/providers",
      description: "Provider profiles not yet verified",
    },
    {
      label: "Companies",
      count: stats.pendingCompanies,
      href: "/admin/verification/companies",
      description: "Provider companies awaiting verification",
    },
    {
      label: "Family authorisations",
      count: stats.pendingFamilyAuthorisations,
      href: "/admin/verification/family",
      description: "Power of attorney, guardianship, and deputyship documents",
    },
  ];

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="font-heading text-3xl font-bold tracking-tight">Verification</h1>
      <p className="mt-1 text-ink-muted">
        Review and approve provider documents, company registrations, and family
        authorisations.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {queues.map((q) => (
          <Link
            key={q.href + q.label}
            href={q.href}
            className="rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-md transition-colors hover:bg-surface"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading font-medium text-ink">{q.label}</h2>
              <span className="text-2xl font-semibold tabular-nums text-ink">
                {q.count}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">{q.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
