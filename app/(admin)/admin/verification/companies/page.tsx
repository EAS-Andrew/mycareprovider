import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { getPendingCompanies } from "@/lib/admin/verification-queries";

export const metadata = {
  title: "Company Verification - Administrator",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function CompaniesVerificationPage({
  searchParams,
}: PageProps) {
  const { error, ok } = await searchParams;
  const companies = await getPendingCompanies();

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link
          href="/admin/verification"
          className="text-sm text-ink-muted underline"
        >
          &larr; Back to verification
        </Link>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">
        Company verification
      </h1>
      <p className="mt-1 text-ink-muted">
        Review and verify provider company registrations.
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

      <div className="mt-8 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Company name
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Company number
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Postcode
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Registered
              </th>
              <th scope="col" className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-ink-muted">
                  No unverified companies.
                </td>
              </tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3 text-ink">{c.company_name}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {c.company_number ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {c.service_postcode ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {new Date(c.created_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/verification/companies/${c.id}`}
                      className={buttonStyles({ variant: "outline", size: "sm" })}
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
