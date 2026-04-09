/**
 * Plain-text transactional email templates for C8 (contact requests,
 * meeting scheduling, thread posts). All templates return a
 * `{ subject, body }` pair. The `from` address and visual theming are
 * applied in `lib/notify/email.ts` based on recipient role, per the PID
 * "Role-addressed surfaces" rule (see docs/pid.md - every transactional
 * email is themed by recipient role).
 *
 * Kept plain-text for the Phase 1a bridge. HTML themed templates land in C9.
 */

import type { LocationMode, MeetingStatus } from "@/lib/contact/types";
import { sanitizeHeader } from "./sanitize";

export type EmailTemplate = {
  subject: string;
  body: string;
};

const LOCATION_LABEL: Record<LocationMode, string> = {
  in_person: "in person",
  video: "by video call",
  phone: "by phone",
};

function formatMeetingAt(iso: string): string {
  // C8 meeting emails are the canonical scheduling record. Show both a
  // human-friendly Europe/London local time (the operational timezone for
  // the marketplace) AND the canonical UTC string so recipients in other
  // zones can still translate without ambiguity. See contact-findings L-4.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const london = date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${london} (${date.toUTCString()})`;
}

function displayName(name: string | null | undefined, fallback: string): string {
  if (!name || name.trim().length === 0) {
    return fallback;
  }
  // sanitizeHeader strips CRLF / C0 controls at the template boundary so a
  // malicious display_name (sourced from signup metadata) cannot inject
  // extra SMTP headers via a subject-line interpolation.
  const clean = sanitizeHeader(name);
  return clean.length === 0 ? fallback : clean;
}

/**
 * Contact request landed in a provider's inbox. Role = provider (purple
 * theme). Copy addresses the provider directly.
 */
export function contactRequestToProvider(params: {
  receiverName: string | null;
  subject: string;
}): EmailTemplate {
  const sender = displayName(params.receiverName, "A potential client");
  // `params.subject` is interpolated into the email subject header; strip
  // CRLF/C0 at the boundary even though the Server Action already sanitises
  // on form validation. Defense-in-depth - a second template caller that
  // forgets to pre-sanitise still cannot inject headers.
  const safeSubject = sanitizeHeader(params.subject);
  return {
    subject: `New contact request: ${safeSubject}`,
    body:
      `Hello,\n\n` +
      `${sender} has sent you a new contact request on MyCareProvider.\n` +
      `Subject: ${safeSubject}\n\n` +
      `Sign in to review it and respond from your provider dashboard.\n\n` +
      `- MyCareProvider (provider notifications)\n`,
  };
}

/**
 * Provider's decision on a receiver's contact request. Role = receiver (blue
 * theme).
 */
export function contactResponseToReceiver(params: {
  providerName: string | null;
  decision: "accepted" | "declined";
  note: string | null;
}): EmailTemplate {
  const provider = displayName(params.providerName, "The provider");
  const verb = params.decision === "accepted" ? "accepted" : "declined";
  // `note` ends up only in the body, not a header, but we sanitise for
  // consistency and to strip stray C0 controls that might mangle rendering.
  const cleanNote =
    params.note && params.note.trim().length > 0
      ? sanitizeHeader(params.note)
      : "";
  const noteLine = cleanNote.length > 0 ? `Their note: ${cleanNote}\n\n` : "";
  const nextStep =
    params.decision === "accepted"
      ? "You can now message them and propose an initial meeting from your dashboard.\n\n"
      : "You can continue browsing other providers from the directory.\n\n";
  return {
    subject: `${provider} ${verb} your contact request`,
    body:
      `Hello,\n\n` +
      `${provider} has ${verb} your contact request on MyCareProvider.\n\n` +
      noteLine +
      nextStep +
      `- MyCareProvider (care receiver notifications)\n`,
  };
}

/**
 * Meeting has been proposed. Sent to whichever party did NOT propose it.
 * The caller passes the recipient's role so `email.ts` themes the `from`.
 */
export function meetingProposedTo(params: {
  proposerName: string | null;
  meetingAt: string;
  locationMode: LocationMode;
}): EmailTemplate {
  const proposer = displayName(params.proposerName, "The other party");
  return {
    subject: `${proposer} proposed a meeting on MyCareProvider`,
    body:
      `Hello,\n\n` +
      `${proposer} has proposed a meeting:\n` +
      `  When: ${formatMeetingAt(params.meetingAt)}\n` +
      `  How:  ${LOCATION_LABEL[params.locationMode]}\n\n` +
      `Sign in to accept, decline, or cancel the meeting from your dashboard.\n\n` +
      `- MyCareProvider\n`,
  };
}

/**
 * Meeting response (accepted / declined / cancelled). Sent to the other
 * party. Status is one of the non-proposed terminal transitions.
 */
export function meetingResponseTo(params: {
  decision: Exclude<MeetingStatus, "proposed">;
  meetingAt: string;
  note: string | null;
}): EmailTemplate {
  const cleanNote =
    params.note && params.note.trim().length > 0
      ? sanitizeHeader(params.note)
      : "";
  const noteLine = cleanNote.length > 0 ? `Note: ${cleanNote}\n\n` : "";
  return {
    subject: `Meeting ${params.decision} on MyCareProvider`,
    body:
      `Hello,\n\n` +
      `A proposed meeting for ${formatMeetingAt(params.meetingAt)} has been ${params.decision}.\n\n` +
      noteLine +
      `Sign in to see the latest status.\n\n` +
      `- MyCareProvider\n`,
  };
}
