import Link from "next/link";

import { listOutgoingContactRequests } from "@/lib/contact/queries";
import type { ContactRequestStatus } from "@/lib/contact/types";

export const metadata = {
  title: "Your contact requests - MyCareProvider",
};

/*
 * Receiver side: outgoing contact requests. Themed blue via the
 * `(receiver)` group layout (`data-theme="blue"`). Uses `bg-brand` /
 * `text-brand` / `ring-brand-ring` so the same JSX would still render
 * correctly if dropped into any other themed group - cross-group imports
 * are forbidden by `scripts/check-theme-isolation.mjs`.
 */

const STATUS_LABEL: Record<ContactRequestStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

const STATUS_CLASS: Record<ContactRequestStatus, string> = {
  pending: "border-border text-ink-muted",
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

export default async function ReceiverContactsIndexPage() {
  // Paginated at the query layer (H-7). First page only in Phase 1a.
  const { rows } = await listOutgoingContactRequests();

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
            Your contact requests
          </h1>
          <p className="mt-2 text-ink-muted">
            Providers you have reached out to. Responses arrive here and by
            email.
          </p>
        </div>
        <Link
          href="/providers"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Find providers
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="font-heading text-lg font-semibold text-ink">
            No contact requests yet
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Browse the directory and reach out to a provider to get started.
          </p>
          <Link
            href="/providers"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Browse providers
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={row.status} />
                  <p className="truncate font-medium text-ink">
                    {row.provider_headline ?? "Care provider"}
                  </p>
                </div>
                <p className="mt-1 truncate text-sm text-ink">{row.subject}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Last updated {formatDate(row.updated_at)}
                </p>
              </div>
              <Link
                href={`/receiver/contacts/${row.id}`}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
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
