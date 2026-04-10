import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { verifyCompany } from "@/lib/admin/verification-actions";
import {
  getCompanyForReview,
  getCompanyDocuments,
} from "@/lib/admin/verification-queries";

export const metadata = {
  title: "Review Company - Administrator",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function CompanyReviewPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error, ok } = await searchParams;

  const company = await getCompanyForReview(id);
  if (!company) notFound();

  const documents = await getCompanyDocuments(id);

  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/verification/companies"
          className="text-sm text-ink-muted underline"
        >
          &larr; Back to company verification
        </Link>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">
        Review company
      </h1>
      <p className="mt-1 text-ink-muted">{company.company_name}</p>

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

      <div className="mt-6 rounded-lg border border-border p-5">
        <h2 className="mb-3 text-lg font-semibold">Company details</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="font-medium text-ink-muted">Company name</dt>
          <dd className="text-ink">{company.company_name}</dd>
          <dt className="font-medium text-ink-muted">Company number</dt>
          <dd className="text-ink">{company.company_number ?? "-"}</dd>
          <dt className="font-medium text-ink-muted">Registered address</dt>
          <dd className="text-ink">{company.registered_address ?? "-"}</dd>
          <dt className="font-medium text-ink-muted">Service postcode</dt>
          <dd className="text-ink">{company.service_postcode ?? "-"}</dd>
          {company.description ? (
            <>
              <dt className="font-medium text-ink-muted">Description</dt>
              <dd className="col-span-2 text-ink">{company.description}</dd>
            </>
          ) : null}
          <dt className="font-medium text-ink-muted">Website</dt>
          <dd className="text-ink">{company.website ?? "-"}</dd>
          <dt className="font-medium text-ink-muted">Phone</dt>
          <dd className="text-ink">{company.phone ?? "-"}</dd>
          <dt className="font-medium text-ink-muted">Status</dt>
          <dd className="text-ink">
            {company.verified_at
              ? `Verified ${new Date(company.verified_at).toLocaleDateString("en-GB")}`
              : "Not verified"}
          </dd>
          <dt className="font-medium text-ink-muted">Registered</dt>
          <dd className="text-ink">
            {new Date(company.created_at).toLocaleDateString("en-GB")}
          </dd>
        </dl>
      </div>

      {/* Documents */}
      <div className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Documents</h2>
        {documents.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No documents uploaded yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Document
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Kind
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Verification
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Uploaded
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const v = Array.isArray(doc.verification)
                    ? doc.verification[0]
                    : doc.verification;
                  return (
                    <tr key={doc.id} className="border-t border-border">
                      <td className="px-4 py-3 text-ink">{doc.title}</td>
                      <td className="px-4 py-3 text-ink-muted">{doc.kind}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                          {v?.state ?? "none"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {new Date(doc.created_at).toLocaleDateString("en-GB")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Verify company action */}
      {!company.verified_at ? (
        <form action={verifyCompany} className="mt-8">
          <input type="hidden" name="companyId" value={company.id} />
          <Button type="submit">Verify company</Button>
        </form>
      ) : null}
    </section>
  );
}
