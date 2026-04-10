import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getDsarRequestForReview,
  processDsarRequest,
  processErasure,
} from "@/lib/admin/dsar-actions";

export const metadata = {
  title: "Review Request - Administrator",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function DsarReviewPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const request = await getDsarRequestForReview(id);

  if (!request) notFound();

  const erasure = request.erasure_request;
  const cooloffExpired = erasure
    ? new Date(erasure.cooloff_ends_at) <= new Date()
    : false;
  const canProcessErasure =
    erasure &&
    cooloffExpired &&
    (erasure.status === "pending_cooloff" ||
      erasure.status === "cooloff_expired");

  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/dsar" className="text-sm text-ink-muted underline">
          &larr; Back to DSAR queue
        </Link>
      </div>

      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {request.request_type === "access"
          ? "Data export request"
          : "Erasure request"}
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

      {/* Request details */}
      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <dt className="font-medium text-ink-muted">Requester</dt>
        <dd className="text-ink">
          {(request.requester as { display_name: string | null })
            ?.display_name ?? "(no name)"}
        </dd>

        <dt className="font-medium text-ink-muted">Email</dt>
        <dd className="text-ink">
          {(request.requester as { email: string | null })?.email ?? "-"}
        </dd>

        <dt className="font-medium text-ink-muted">Type</dt>
        <dd className="text-ink capitalize">{request.request_type}</dd>

        <dt className="font-medium text-ink-muted">Status</dt>
        <dd className="text-ink">
          <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
            {request.status}
          </span>
        </dd>

        <dt className="font-medium text-ink-muted">Requested</dt>
        <dd className="text-ink">
          {new Date(request.requested_at).toLocaleString("en-GB")}
        </dd>

        {request.processed_at ? (
          <>
            <dt className="font-medium text-ink-muted">Processed</dt>
            <dd className="text-ink">
              {new Date(request.processed_at).toLocaleString("en-GB")}
            </dd>
          </>
        ) : null}

        {request.download_url ? (
          <>
            <dt className="font-medium text-ink-muted">Download</dt>
            <dd>
              <a
                href={request.download_url}
                className="text-brand underline"
                download
              >
                Export bundle (JSON)
              </a>
              {request.download_expires_at ? (
                <span className="ml-2 text-xs text-ink-muted">
                  expires{" "}
                  {new Date(request.download_expires_at).toLocaleDateString(
                    "en-GB",
                  )}
                </span>
              ) : null}
            </dd>
          </>
        ) : null}

        {request.rejection_reason ? (
          <>
            <dt className="font-medium text-ink-muted">Rejection reason</dt>
            <dd className="text-ink">{request.rejection_reason}</dd>
          </>
        ) : null}
      </dl>

      {/* Erasure-specific details */}
      {erasure ? (
        <div className="mt-8 rounded-2xl border-2 border-neutral-100 bg-white p-6 shadow-md">
          <h2 className="font-heading font-semibold text-ink">Erasure details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="font-medium text-ink-muted">Erasure status</dt>
            <dd className="text-ink">{erasure.status}</dd>

            <dt className="font-medium text-ink-muted">Cool-off ends</dt>
            <dd className="text-ink">
              {new Date(erasure.cooloff_ends_at).toLocaleString("en-GB")}
              {cooloffExpired ? (
                <span className="ml-2 text-xs font-medium text-danger">
                  Expired
                </span>
              ) : (
                <span className="ml-2 text-xs text-ink-muted">Active</span>
              )}
            </dd>

            {erasure.legal_holds && erasure.legal_holds.length > 0 ? (
              <>
                <dt className="font-medium text-ink-muted">Legal holds</dt>
                <dd className="text-ink">
                  <ul className="list-disc pl-4">
                    {erasure.legal_holds.map((hold, i) => (
                      <li key={i}>
                        <span className="font-medium">{hold.table}</span> -{" "}
                        {hold.reason}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            ) : null}
          </dl>

          {canProcessErasure ? (
            <form action={processErasure} className="mt-6">
              <input type="hidden" name="erasureId" value={erasure.id} />
              <Button
                type="submit"
                className="bg-danger text-white hover:bg-danger/90"
              >
                Process erasure
              </Button>
              <p className="mt-2 text-xs text-ink-muted">
                This will soft-delete all user data across regulated tables.
                Audit log entries and safeguarding records will be retained.
              </p>
            </form>
          ) : null}
        </div>
      ) : null}

      {/* Admin actions for non-erasure or incomplete requests */}
      {request.status === "pending" || request.status === "processing" ? (
        <form action={processDsarRequest} className="mt-8 space-y-4">
          <input type="hidden" name="requestId" value={request.id} />

          {request.request_type === "access" &&
          request.status === "pending" ? (
            <div className="space-y-2">
              <label
                htmlFor="rejectionReason"
                className="block text-sm font-medium text-ink"
              >
                Rejection reason (optional)
              </label>
              <textarea
                id="rejectionReason"
                name="rejectionReason"
                rows={3}
                className="flex w-full rounded-xl border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              />
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            {request.status === "pending" ? (
              <>
                <Button
                  type="submit"
                  name="action"
                  value="processing"
                >
                  Mark processing
                </Button>
                <Button
                  type="submit"
                  name="action"
                  value="completed"
                >
                  Mark completed
                </Button>
                <Button
                  type="submit"
                  name="action"
                  value="rejected"
                  variant="outline"
                >
                  Reject
                </Button>
              </>
            ) : (
              <Button type="submit" name="action" value="completed">
                Mark completed
              </Button>
            )}
          </div>
        </form>
      ) : null}
    </section>
  );
}
