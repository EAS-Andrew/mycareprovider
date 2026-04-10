import Link from "next/link";
import { notFound } from "next/navigation";

import { getContactRequestWithThread } from "@/lib/contact/queries";
import type {
  ContactRequestStatus,
  LocationMode,
  MeetingProposalRow,
  MeetingStatus,
} from "@/lib/contact/types";
import { createServerClient } from "@/lib/supabase/server";

import {
  postToThreadAction,
  proposeMeetingAction,
  respondToMeetingAction,
  withdrawContactRequestAction,
} from "../_actions";

export const metadata = {
  title: "Contact request - MyCareProvider",
};

/*
 * Receiver-side single contact-request detail view. Themed blue via the
 * `(receiver)` group layout. Intentionally duplicates the provider-side
 * detail view rather than cross-importing; the theme comes from the
 * layout, not from the component.
 */

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

const REQUEST_STATUS_LABEL: Record<ContactRequestStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

const REQUEST_STATUS_CLASS: Record<ContactRequestStatus, string> = {
  pending: "border-border text-ink-muted",
  accepted: "border-success text-success",
  declined: "border-danger text-danger",
  expired: "border-border text-ink-muted",
  withdrawn: "border-border text-ink-muted",
};

const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

const MEETING_STATUS_CLASS: Record<MeetingStatus, string> = {
  proposed: "border-border text-ink-muted",
  accepted: "border-success text-success",
  declined: "border-danger text-danger",
  cancelled: "border-border text-ink-muted",
};

const LOCATION_LABEL: Record<LocationMode, string> = {
  in_person: "In person",
  video: "Video call",
  phone: "Phone",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
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

function formatMeetingAt(iso: string, durationMinutes: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const end = new Date(d.getTime() + durationMinutes * 60_000);
  const dateStr = d.toLocaleString("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const endStr = end.toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateStr} - ${endStr}`;
}

export default async function ReceiverContactDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error, notice } = await searchParams;

  const detail = await getContactRequestWithThread(id);
  if (!detail) {
    notFound();
  }

  // Identify the viewer so we can render the correct accept/decline
  // affordances on meeting proposals. The receiver route group has already
  // gated role access in the proxy layer; we only need the user id here.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? "";

  const request = detail.request;
  const canWithdraw = request.status === "pending";
  const threadPostable =
    request.status === "accepted" && detail.thread !== null;
  const canProposeMeeting = request.status === "accepted";

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link
          href="/receiver/contacts"
          className="rounded-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          ← All contact requests
        </Link>
      </nav>

      <header className="space-y-3 rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${REQUEST_STATUS_CLASS[request.status]}`}
          >
            {REQUEST_STATUS_LABEL[request.status]}
          </span>
          <p className="text-sm text-ink-muted">
            Sent {formatDateTime(request.created_at)}
          </p>
        </div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
          {request.subject}
        </h1>
        <p className="text-sm text-ink-muted">
          To{" "}
          <span className="font-medium text-ink">
            {request.provider_headline ?? "Care provider"}
          </span>
        </p>
        {request.response_note ? (
          <div className="rounded-xl border border-border bg-canvas p-3 text-sm text-ink">
            <p className="font-medium">Provider note</p>
            <p className="mt-1 whitespace-pre-line">{request.response_note}</p>
          </div>
        ) : null}
        <div>
          <h2 className="sr-only">Your message</h2>
          <p className="whitespace-pre-line text-base text-ink">
            {request.body}
          </p>
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          {notice}
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

      {canWithdraw ? (
        <form action={withdrawContactRequestAction}>
          <input type="hidden" name="id" value={request.id} />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Withdraw request
          </button>
        </form>
      ) : null}

      <section className="space-y-4" aria-labelledby="meetings-heading">
        <h2
          id="meetings-heading"
          className="font-heading text-xl font-semibold tracking-tight text-ink"
        >
          Meetings
        </h2>

        {detail.proposals.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No meetings have been proposed yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {detail.proposals.map((p) => (
              <MeetingRow
                key={p.id}
                proposal={p}
                viewerId={viewerId}
                contactRequestId={request.id}
              />
            ))}
          </ul>
        )}

        {canProposeMeeting ? (
          <details className="rounded-2xl border border-border bg-surface p-5">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Propose a new meeting
            </summary>
            <form
              action={proposeMeetingAction}
              className="mt-4 space-y-4"
              noValidate
            >
              <input
                type="hidden"
                name="contact_request_id"
                value={request.id}
              />

              <div className="space-y-2">
                <label
                  htmlFor="meeting_at"
                  className="block text-sm font-medium text-ink"
                >
                  When
                </label>
                <input
                  id="meeting_at"
                  name="meeting_at"
                  type="datetime-local"
                  required
                  aria-describedby={error ? "form-error" : "meeting-at-hint"}
                  className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
                />
                <p id="meeting-at-hint" className="text-xs text-ink-muted">
                  At least one hour in the future.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="duration_minutes"
                    className="block text-sm font-medium text-ink"
                  >
                    Length (minutes)
                  </label>
                  <input
                    id="duration_minutes"
                    name="duration_minutes"
                    type="number"
                    min={15}
                    max={240}
                    step={5}
                    defaultValue={30}
                    required
                    aria-describedby={error ? "form-error" : undefined}
                    className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="location_mode"
                    className="block text-sm font-medium text-ink"
                  >
                    How
                  </label>
                  <select
                    id="location_mode"
                    name="location_mode"
                    required
                    defaultValue="video"
                    aria-describedby={error ? "form-error" : undefined}
                    className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
                  >
                    <option value="video">Video call</option>
                    <option value="phone">Phone</option>
                    <option value="in_person">In person</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="location_detail"
                  className="block text-sm font-medium text-ink"
                >
                  Details (optional)
                </label>
                <input
                  id="location_detail"
                  name="location_detail"
                  type="text"
                  maxLength={240}
                  aria-describedby={error ? "form-error" : "location-hint"}
                  className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
                />
                <p id="location-hint" className="text-xs text-ink-muted">
                  Meeting link, phone number, or venue.
                </p>
              </div>

              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                Propose meeting
              </button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="thread-heading">
        <h2
          id="thread-heading"
          className="font-heading text-xl font-semibold tracking-tight text-ink"
        >
          Messages
        </h2>

        {detail.thread === null ? (
          <p className="text-sm text-ink-muted">
            Once the provider accepts your request, the conversation will
            open here.
          </p>
        ) : detail.posts.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No messages yet. Say hello.
          </p>
        ) : (
          <ul className="space-y-3">
            {detail.posts.map((post) => {
              const mine = post.author_id === viewerId;
              return (
                <li
                  key={post.id}
                  className={`rounded-2xl border p-4 ${
                    mine
                      ? "border-brand bg-surface"
                      : "border-border bg-canvas"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <span className="font-medium text-ink">
                      {mine ? "You" : "Provider"}
                    </span>
                    <time dateTime={post.created_at}>
                      {formatDateTime(post.created_at)}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-ink">
                    {post.body}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {threadPostable && detail.thread ? (
          <form
            action={postToThreadAction}
            className="space-y-3 rounded-2xl border border-border bg-surface p-5"
            noValidate
          >
            <input
              type="hidden"
              name="contact_request_id"
              value={request.id}
            />
            <input type="hidden" name="thread_id" value={detail.thread.id} />
            <div className="space-y-2">
              <label htmlFor="body" className="block text-sm font-medium text-ink">
                Your message
              </label>
              <textarea
                id="body"
                name="body"
                rows={4}
                required
                minLength={1}
                maxLength={2000}
                aria-describedby={error ? "form-error" : "post-hint"}
                className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
              />
              <p id="post-hint" className="text-xs text-ink-muted">
                The provider will see this message and receive an email.
              </p>
            </div>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              Send message
            </button>
          </form>
        ) : null}
      </section>
    </section>
  );
}

function MeetingRow({
  proposal,
  viewerId,
  contactRequestId,
}: {
  proposal: MeetingProposalRow;
  viewerId: string;
  contactRequestId: string;
}) {
  const iProposed = proposal.proposed_by === viewerId;
  const canRespond = proposal.status === "proposed" && !iProposed;
  const canCancel = proposal.status === "proposed" && iProposed;

  return (
    <li className="space-y-3 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${MEETING_STATUS_CLASS[proposal.status]}`}
        >
          {MEETING_STATUS_LABEL[proposal.status]}
        </span>
        <p className="text-sm text-ink-muted">
          Proposed by {iProposed ? "you" : "the provider"}
        </p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">When</dt>
          <dd className="mt-1 font-medium text-ink">
            {formatMeetingAt(proposal.meeting_at, proposal.duration_minutes)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">How</dt>
          <dd className="mt-1 font-medium text-ink">
            {LOCATION_LABEL[proposal.location_mode]}
          </dd>
        </div>
        {proposal.location_detail ? (
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">Details</dt>
            <dd className="mt-1 text-ink">{proposal.location_detail}</dd>
          </div>
        ) : null}
        {proposal.response_note ? (
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">Response note</dt>
            <dd className="mt-1 whitespace-pre-line text-ink">
              {proposal.response_note}
            </dd>
          </div>
        ) : null}
      </dl>

      {canRespond ? (
        <div className="flex flex-wrap gap-3">
          <form action={respondToMeetingAction}>
            <input
              type="hidden"
              name="contact_request_id"
              value={contactRequestId}
            />
            <input type="hidden" name="id" value={proposal.id} />
            <input type="hidden" name="decision" value="accepted" />
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              Accept
            </button>
          </form>
          <form action={respondToMeetingAction}>
            <input
              type="hidden"
              name="contact_request_id"
              value={contactRequestId}
            />
            <input type="hidden" name="id" value={proposal.id} />
            <input type="hidden" name="decision" value="declined" />
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              Decline
            </button>
          </form>
        </div>
      ) : null}

      {canCancel ? (
        <form action={respondToMeetingAction}>
          <input
            type="hidden"
            name="contact_request_id"
            value={contactRequestId}
          />
          <input type="hidden" name="id" value={proposal.id} />
          <input type="hidden" name="decision" value="cancelled" />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Cancel proposal
          </button>
        </form>
      ) : null}
    </li>
  );
}
