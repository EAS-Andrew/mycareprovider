import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import {
  getPendingProviders,
  getPendingVerifications,
} from "@/lib/admin/verification-queries";

export const metadata = {
  title: "Provider Verification - Administrator",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function ProvidersVerificationPage({
  searchParams,
}: PageProps) {
  const { error, ok } = await searchParams;
  const [verifications, providers] = await Promise.all([
    getPendingVerifications(),
    getPendingProviders(),
  ]);

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
        Provider verification
      </h1>
      <p className="mt-1 text-ink-muted">
        Review provider profiles and their uploaded documents.
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

      {/* Unverified providers */}
      <h2 className="mt-8 text-xl font-semibold">Unverified providers</h2>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Headline
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Location
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Registered
              </th>
              <th scope="col" className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-ink-muted">
                  No unverified providers.
                </td>
              </tr>
            ) : (
              providers.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-3 text-ink">
                    {(p.profile as { display_name: string | null })
                      ?.display_name ?? "(no name)"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {p.headline ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {[p.city, p.postcode].filter(Boolean).join(", ") || "-"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {new Date(p.created_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/verification/providers/${p.id}`}
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

      {/* Pending document verifications */}
      <h2 className="mt-10 text-xl font-semibold">
        Pending document verifications
      </h2>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
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
                State
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Uploaded
              </th>
              <th scope="col" className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {verifications.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-ink-muted">
                  No pending document verifications.
                </td>
              </tr>
            ) : (
              verifications.map((v) => {
                const doc = v.document as {
                  id: string;
                  kind: string;
                  title: string;
                  status: string;
                  created_at: string;
                };
                return (
                  <tr key={v.id} className="border-t border-border">
                    <td className="px-4 py-3 text-ink">{doc.title}</td>
                    <td className="px-4 py-3 text-ink-muted">{doc.kind}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                        {v.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(doc.created_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/verification/providers/${v.id}?type=document`}
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
