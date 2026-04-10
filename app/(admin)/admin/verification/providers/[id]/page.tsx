import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, buttonStyles } from "@/components/ui/button";
import {
  reviewDocument,
  verifyProvider,
} from "@/lib/admin/verification-actions";
import {
  getProviderForReview,
  getProviderDocuments,
  getDocumentForReview,
} from "@/lib/admin/verification-queries";

export const metadata = {
  title: "Review Provider - Administrator",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; type?: string }>;
};

export default async function ProviderReviewPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error, ok, type } = await searchParams;

  // If type=document, this is a document verification review
  if (type === "document") {
    const verification = await getDocumentForReview(id);
    if (!verification) notFound();

    const doc = verification.document as {
      id: string;
      kind: string;
      title: string;
      description: string | null;
      status: string;
      mime_type: string;
      size_bytes: number;
      expires_at: string | null;
      created_at: string;
    };

    return (
      <section className="mx-auto max-w-2xl">
        <div className="mb-6">
          <Link
            href="/admin/verification/providers"
            className="text-sm text-ink-muted underline"
          >
            &larr; Back to provider verification
          </Link>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight">
          Review document
        </h1>

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
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="font-medium text-ink-muted">Title</dt>
            <dd className="text-ink">{doc.title}</dd>
            <dt className="font-medium text-ink-muted">Kind</dt>
            <dd className="text-ink">{doc.kind}</dd>
            <dt className="font-medium text-ink-muted">Status</dt>
            <dd className="text-ink">{doc.status}</dd>
            <dt className="font-medium text-ink-muted">MIME type</dt>
            <dd className="text-ink">{doc.mime_type}</dd>
            <dt className="font-medium text-ink-muted">Size</dt>
            <dd className="text-ink">
              {(doc.size_bytes / 1024).toFixed(1)} KB
            </dd>
            {doc.expires_at ? (
              <>
                <dt className="font-medium text-ink-muted">Expires</dt>
                <dd className="text-ink">
                  {new Date(doc.expires_at).toLocaleDateString("en-GB")}
                </dd>
              </>
            ) : null}
            {doc.description ? (
              <>
                <dt className="font-medium text-ink-muted">Description</dt>
                <dd className="col-span-2 text-ink">{doc.description}</dd>
              </>
            ) : null}
            <dt className="font-medium text-ink-muted">Verification state</dt>
            <dd className="text-ink">{verification.state}</dd>
            {verification.notes ? (
              <>
                <dt className="font-medium text-ink-muted">Previous notes</dt>
                <dd className="col-span-2 text-ink">{verification.notes}</dd>
              </>
            ) : null}
            <dt className="font-medium text-ink-muted">Uploaded</dt>
            <dd className="text-ink">
              {new Date(doc.created_at).toLocaleDateString("en-GB")}
            </dd>
          </dl>
        </div>

        {verification.state !== "approved" ? (
          <form action={reviewDocument} className="mt-6 space-y-4">
            <input type="hidden" name="verificationId" value={verification.id} />
            <div className="space-y-2">
              <label
                htmlFor="notes"
                className="block text-sm font-medium text-ink"
              >
                Review notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                placeholder="Optional notes for this review decision"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" name="decision" value="approved">
                Approve
              </Button>
              <Button
                type="submit"
                name="decision"
                value="rejected"
                variant="outline"
              >
                Reject
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    );
  }

  // Otherwise, this is a provider profile review
  const provider = await getProviderForReview(id);
  if (!provider) notFound();

  const documents = await getProviderDocuments(id);
  const profile = provider.profile as {
    display_name: string | null;
    email: string | null;
  };

  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/verification/providers"
          className="text-sm text-ink-muted underline"
        >
          &larr; Back to provider verification
        </Link>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">
        Review provider
      </h1>
      <p className="mt-1 text-ink-muted">
        {profile?.display_name ?? "(no name)"} - {profile?.email ?? "(no email)"}
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

      {/* Provider profile details */}
      <div className="mt-6 rounded-lg border border-border p-5">
        <h2 className="mb-3 text-lg font-semibold">Profile</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="font-medium text-ink-muted">Headline</dt>
          <dd className="text-ink">{provider.headline ?? "-"}</dd>
          <dt className="font-medium text-ink-muted">Location</dt>
          <dd className="text-ink">
            {[provider.city, provider.postcode].filter(Boolean).join(", ") ||
              "-"}
          </dd>
          <dt className="font-medium text-ink-muted">Experience</dt>
          <dd className="text-ink">
            {provider.years_experience != null
              ? `${provider.years_experience} years`
              : "-"}
          </dd>
          <dt className="font-medium text-ink-muted">Hourly rate</dt>
          <dd className="text-ink">
            {provider.hourly_rate_pence != null
              ? `${(provider.hourly_rate_pence / 100).toFixed(2)}`
              : "-"}
          </dd>
          {provider.bio ? (
            <>
              <dt className="font-medium text-ink-muted">Bio</dt>
              <dd className="col-span-2 text-ink">{provider.bio}</dd>
            </>
          ) : null}
          <dt className="font-medium text-ink-muted">Status</dt>
          <dd className="text-ink">
            {provider.verified_at
              ? `Verified ${new Date(provider.verified_at).toLocaleDateString("en-GB")}`
              : "Not verified"}
          </dd>
          <dt className="font-medium text-ink-muted">Registered</dt>
          <dd className="text-ink">
            {new Date(provider.created_at).toLocaleDateString("en-GB")}
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

      {/* Verify provider action */}
      {!provider.verified_at ? (
        <form action={verifyProvider} className="mt-8">
          <input type="hidden" name="providerId" value={provider.id} />
          <Button type="submit">Verify provider</Button>
        </form>
      ) : null}
    </section>
  );
}
