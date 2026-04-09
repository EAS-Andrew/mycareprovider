/**
 * Non-async exports for the contact/messaging module. `lib/contact/actions.ts`
 * is a `"use server"` file, so type aliases and the sync `ContactValidationError`
 * class live here to avoid the Next.js restriction that use-server modules may
 * only export async functions.
 *
 * Matches the schema shipped in `supabase/migrations/0008_contact_messaging.sql`.
 */

export const CONTACT_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

export const MEETING_STATUSES = [
  "proposed",
  "accepted",
  "declined",
  "cancelled",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const LOCATION_MODES = ["in_person", "video", "phone"] as const;
export type LocationMode = (typeof LOCATION_MODES)[number];

export type ContactResponseDecision = "accepted" | "declined";
export type MeetingDecision = "accepted" | "declined" | "cancelled";

export function isLocationMode(value: string): value is LocationMode {
  return (LOCATION_MODES as readonly string[]).includes(value);
}

export function isContactResponseDecision(
  value: string,
): value is ContactResponseDecision {
  return value === "accepted" || value === "declined";
}

export function isMeetingDecision(value: string): value is MeetingDecision {
  return value === "accepted" || value === "declined" || value === "cancelled";
}

export type ContactRequestRow = {
  id: string;
  receiver_id: string;
  provider_id: string;
  subject: string;
  body: string;
  status: ContactRequestStatus;
  responded_at: string | null;
  response_note: string | null;
  created_at: string;
  updated_at: string;
};

export type IncomingContactRequestRow = ContactRequestRow & {
  receiver_display_name: string | null;
};

export type OutgoingContactRequestRow = ContactRequestRow & {
  provider_headline: string | null;
};

export type MeetingProposalRow = {
  id: string;
  contact_request_id: string;
  proposed_by: string;
  proposed_at: string;
  meeting_at: string;
  duration_minutes: number;
  location_mode: LocationMode;
  location_detail: string | null;
  status: MeetingStatus;
  responded_at: string | null;
  response_note: string | null;
  created_at: string;
  updated_at: string;
};

export type ThreadRow = {
  id: string;
  contact_request_id: string;
  created_at: string;
  updated_at: string;
};

export type ThreadPostRow = {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type ContactRequestDetail = {
  request: ContactRequestRow & {
    receiver_display_name: string | null;
    provider_headline: string | null;
  };
  proposals: MeetingProposalRow[];
  thread: ThreadRow | null;
  posts: ThreadPostRow[];
};

/**
 * Typed error thrown from the contact Server Actions when a validation,
 * authorization, or rate-limit failure occurs. Callers can distinguish cases
 * by `error.code`. Keep codes stable; they are part of the action contract
 * that `frontend-engineer` depends on.
 *
 * Known codes:
 *   - `sign_in_required`       : no authenticated user
 *   - `profile_not_found`      : authenticated but no profile row
 *   - `role_forbidden`         : caller role not allowed on this action
 *   - `missing_<field>`        : required form field absent
 *   - `invalid_<field>`        : form field failed length/format validation
 *   - `provider_not_available` : target provider missing, unverified, or soft-deleted
 *   - `not_found`              : referenced row missing or hidden by RLS
 *   - `forbidden`              : caller is not party to the row
 *   - `invalid_transition`     : DB guard trigger rejected the status change
 *   - `rate_limited`           : `app.bump_rate_limit` raised P0001 `rate_limited`
 *   - `db_error`               : any other unclassified Supabase error
 */
export class ContactValidationError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ContactValidationError";
    this.code = code;
  }
}
