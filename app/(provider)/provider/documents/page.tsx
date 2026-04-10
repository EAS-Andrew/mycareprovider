import Link from "next/link";
import { listOwnDocuments } from "@/lib/documents/actions";
import type {
  DocumentKind,
  ProviderDocumentRow,
} from "@/lib/documents/types";
import { submitSoftDelete } from "./actions";

export const metadata = {
  title: "Your documents - MyCareProvider",
};

const KIND_LABELS: Record<DocumentKind, string> = {
  dbs: "DBS",
  insurance: "Insurance",
  certification: "Certification",
  identity: "Identity",
  right_to_work: "Right to work",
  other: "Other",
};

type PageProps = {
  searchParams: Promise<{
    error?: string;
    uploaded?: string;
    deleted?: string;
  }>;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  // Render as an ISO date only (YYYY-MM-DD) to avoid locale jitter in SSR.
  return iso.slice(0, 10);
}

type BadgeTone = "neutral" | "success" | "warning" | "danger";

function Badge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
}) {
  const classes: Record<BadgeTone, string> = {
    neutral: "border-border text-ink-muted",
    success: "border-success text-success",
    warning: "border-warning text-warning",
    danger: "border-danger text-danger",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${classes[tone]}`}
    >
      {children}
    </span>
  );
}

function statusBadge(status: ProviderDocumentRow["status"]) {
  switch (status) {
    case "available":
      return <Badge tone="success">Available</Badge>;
    case "quarantined":
      return <Badge tone="warning">Quarantined</Badge>;
    case "rejected":
      return <Badge tone="danger">Rejected</Badge>;
  }
}

function verificationBadge(
  state: ProviderDocumentRow["verification_state"],
) {
  switch (state) {
    case "approved":
      return <Badge tone="success">Approved</Badge>;
    case "rejected":
      return <Badge tone="danger">Rejected</Badge>;
    case "in_review":
      return <Badge tone="warning">In review</Badge>;
    case "pending":
      return <Badge tone="neutral">Pending</Badge>;
    case null:
      return <Badge tone="neutral">No review</Badge>;
  }
}

export default async function ProviderDocumentsPage({
  searchParams,
}: PageProps) {
  const { error, uploaded, deleted } = await searchParams;
  const documents = await listOwnDocuments();

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
            Your documents
          </h1>
          <p className="mt-1 text-ink-muted">
            Upload identity, DBS, insurance, and any certifications. Our team
            reviews every document before it becomes part of your verified
            profile.
          </p>
        </div>
        <Link
          href="/provider/documents/upload"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Upload document
        </Link>
      </header>

      {uploaded ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          Document uploaded. It will be reviewed before it is added to your
          verified profile.
        </div>
      ) : null}

      {deleted ? (
        <div
          role="status"
          className="rounded-xl border border-brand bg-surface p-3 text-sm text-ink"
        >
          Document removed.
        </div>
      ) : null}

      {error ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {documents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-sm text-ink-muted">
            You have not uploaded any documents yet.
          </p>
          <Link
            href="/provider/documents/upload"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Upload your first document
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{doc.title}</p>
                  <Badge tone="neutral">{KIND_LABELS[doc.kind]}</Badge>
                  {statusBadge(doc.status)}
                  {verificationBadge(doc.verification_state)}
                </div>
                {doc.description ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    {doc.description}
                  </p>
                ) : null}
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
                  <div>
                    <dt className="inline">Uploaded: </dt>
                    <dd className="inline text-ink">
                      {formatDate(doc.created_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Size: </dt>
                    <dd className="inline text-ink">
                      {formatBytes(doc.size_bytes)}
                    </dd>
                  </div>
                  {doc.expires_at ? (
                    <div>
                      <dt className="inline">Expires: </dt>
                      <dd className="inline text-ink">
                        {formatDate(doc.expires_at)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {doc.status === "rejected" && doc.rejected_reason ? (
                  <p className="mt-2 text-sm text-danger">
                    Rejected: {doc.rejected_reason}
                  </p>
                ) : null}
                {doc.verification_state === "rejected" &&
                doc.verification_notes ? (
                  <p className="mt-2 text-sm text-danger">
                    Review notes: {doc.verification_notes}
                  </p>
                ) : null}
              </div>

              {/*
                Two-step native confirm with no client JS: a <details>
                collapses the destructive action behind a disclosure, so a
                single accidental click never removes a document. Opening the
                disclosure and clicking the confirm button is the intent.
              */}
              <details className="group shrink-0 rounded-xl">
                <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center rounded-xl border border-danger px-4 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring [&::-webkit-details-marker]:hidden">
                  Remove
                </summary>
                <form
                  action={submitSoftDelete}
                  className="mt-2 flex flex-col gap-2 rounded-xl border border-danger bg-canvas p-3 text-sm text-ink"
                >
                  <input type="hidden" name="document_id" value={doc.id} />
                  <p>
                    Remove <span className="font-medium">{doc.title}</span>?
                    This cannot be undone.
                  </p>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center rounded-xl bg-danger px-4 text-sm font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                    aria-label={`Confirm removal of ${doc.title}`}
                  >
                    Confirm remove
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
