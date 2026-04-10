import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { getPendingFamilyAuthorisations } from "@/lib/admin/verification-queries";

export const metadata = {
  title: "Family Authorisation Verification - Administrator",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  power_of_attorney: "Power of attorney",
  legal_guardian: "Legal guardian",
  deputyship: "Deputyship",
  other: "Other",
};

export default async function FamilyVerificationPage({
  searchParams,
}: PageProps) {
  const { error, ok } = await searchParams;
  const authorisations = await getPendingFamilyAuthorisations();

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
        Family authorisation verification
      </h1>
      <p className="mt-1 text-ink-muted">
        Review power of attorney, guardianship, and deputyship documents.
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
                Type
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Document
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Granted
              </th>
              <th scope="col" className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {authorisations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-ink-muted">
                  No unverified family authorisations.
                </td>
              </tr>
            ) : (
              authorisations.map((a) => {
                const doc = a.document as {
                  id: string;
                  title: string;
                } | null;
                return (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-3 text-ink">
                      {TYPE_LABELS[a.authorisation_type] ??
                        a.authorisation_type}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {doc?.title ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(a.granted_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/verification/family/${a.id}`}
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
