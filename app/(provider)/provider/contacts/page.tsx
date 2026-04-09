import Link from "next/link";

import { listIncomingContactRequests } from "@/lib/contact/queries";
import type { ContactRequestStatus } from "@/lib/contact/types";

export const metadata = {
  title: "Contact requests - MyCareProvider",
};

/*
 * Provider side: incoming contact requests. Themed purple via the
 * `(provider)` group layout (`data-theme="purple"`). Same JSX shape as
 * the receiver index - duplicated rather than shared because cross-group
 * imports are a review-blocker.
 */

const STATUS_LABEL: Record<ContactRequestStatus, string> = {
  pending: "New",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

const STATUS_CLASS: Record<ContactRequestStatus, string> = {
  pending: "border-brand text-brand",
  accepted: "border-success text-success",
  declined: "border-danger text-danger",
  expired: "border-border text-ink-muted",
  withdrawn: "border-border text-ink-muted",
};

function StatusBadge({ status }: { status: ContactRequestStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ProviderContactsIndexPage() {
  // Paginated at the query layer (H-7). Phase 1a renders only the first
  // page; a cursor-driven "Load more" control ships with C9.
  const { rows } = await listIncomingContactRequests();

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Contact requests
        </h1>
        <p className="mt-2 text-ink-muted">
          People who have reached out to you. Respond promptly; families are
          usually talking to several providers.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">No requests yet</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Once your profile is verified and visible in the directory,
            contact requests will arrive here.
          </p>
          <Link
            href="/provider"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md border border-brand px-5 text-base font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Back to dashboard
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={row.status} />
                  <p className="truncate font-medium text-ink">
                    {row.receiver_display_name ?? "Care receiver"}
                  </p>
                </div>
                <p className="mt-1 truncate text-sm text-ink">{row.subject}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Received {formatDate(row.created_at)}
                </p>
              </div>
              <Link
                href={`/provider/contacts/${row.id}`}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
