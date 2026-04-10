import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { verifyFamilyAuthorisation } from "@/lib/admin/verification-actions";
import { getFamilyAuthorisationForReview } from "@/lib/admin/verification-queries";

export const metadata = {
  title: "Review Family Authorisation - Administrator",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  power_of_attorney: "Power of attorney",
  legal_guardian: "Legal guardian",
  deputyship: "Deputyship",
  other: "Other",
};

export default async function FamilyAuthorisationReviewPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error, ok } = await searchParams;

  const authorisation = await getFamilyAuthorisationForReview(id);
  if (!authorisation) notFound();

  const doc = authorisation.document as {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    status: string;
    mime_type: string;
    created_at: string;
  } | null;

  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/verification/family"
          className="text-sm text-ink-muted underline"
        >
          &larr; Back to family authorisation verification
        </Link>
      </div>

      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Review family authorisation
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

      <div className="mt-6 rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-md">
        <h2 className="font-heading mb-3 text-lg font-semibold">Authorisation details</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="font-medium text-ink-muted">Type</dt>
          <dd className="text-ink">
            {TYPE_LABELS[authorisation.authorisation_type] ??
              authorisation.authorisation_type}
          </dd>
          <dt className="font-medium text-ink-muted">Granted</dt>
          <dd className="text-ink">
            {new Date(authorisation.granted_at).toLocaleDateString("en-GB")}
          </dd>
          {authorisation.expires_at ? (
            <>
              <dt className="font-medium text-ink-muted">Expires</dt>
              <dd className="text-ink">
                {new Date(authorisation.expires_at).toLocaleDateString("en-GB")}
              </dd>
            </>
          ) : null}
          {authorisation.notes ? (
            <>
              <dt className="font-medium text-ink-muted">Notes</dt>
              <dd className="col-span-2 text-ink">{authorisation.notes}</dd>
            </>
          ) : null}
          <dt className="font-medium text-ink-muted">Status</dt>
          <dd className="text-ink">
            {authorisation.verified_at
              ? `Verified ${new Date(authorisation.verified_at).toLocaleDateString("en-GB")}`
              : "Not verified"}
          </dd>
          <dt className="font-medium text-ink-muted">Created</dt>
          <dd className="text-ink">
            {new Date(authorisation.created_at).toLocaleDateString("en-GB")}
          </dd>
        </dl>
      </div>

      {/* Attached document */}
      {doc ? (
        <div className="mt-6 rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-md">
          <h2 className="font-heading mb-3 text-lg font-semibold">Attached document</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="font-medium text-ink-muted">Title</dt>
            <dd className="text-ink">{doc.title}</dd>
            <dt className="font-medium text-ink-muted">Kind</dt>
            <dd className="text-ink">{doc.kind}</dd>
            <dt className="font-medium text-ink-muted">Status</dt>
            <dd className="text-ink">{doc.status}</dd>
            <dt className="font-medium text-ink-muted">MIME type</dt>
            <dd className="text-ink">{doc.mime_type}</dd>
            {doc.description ? (
              <>
                <dt className="font-medium text-ink-muted">Description</dt>
                <dd className="col-span-2 text-ink">{doc.description}</dd>
              </>
            ) : null}
            <dt className="font-medium text-ink-muted">Uploaded</dt>
            <dd className="text-ink">
              {new Date(doc.created_at).toLocaleDateString("en-GB")}
            </dd>
          </dl>
        </div>
      ) : null}

      {/* Verify action */}
      {!authorisation.verified_at ? (
        <form action={verifyFamilyAuthorisation} className="mt-8">
          <input type="hidden" name="authorisationId" value={authorisation.id} />
          <Button type="submit">Verify authorisation</Button>
        </form>
      ) : null}
    </section>
  );
}
