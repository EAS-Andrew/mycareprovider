"use server";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { sendEmail, type EmailRole } from "@/lib/notify/email";
import { sanitizeHeader } from "@/lib/notify/sanitize";
import {
  contactRequestToProvider,
  contactResponseToReceiver,
  meetingProposedTo,
  meetingResponseTo,
} from "@/lib/notify/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import {
  ContactValidationError,
  isContactResponseDecision,
  isLocationMode,
  isMeetingDecision,
  type ContactResponseDecision,
  type LocationMode,
  type MeetingDecision,
} from "./types";

/**
 * C8 contact, meeting, and thread-post Server Actions.
 *
 * Mirrors the shape of `lib/providers/actions.ts` and
 * `lib/documents/actions.ts`: every mutation goes through the user-scoped
 * Supabase client so the C8 RLS policies + guard triggers in
 * `supabase/migrations/0008_contact_messaging.sql` are the authoritative
 * gate, and every mutation writes a W2 audit event with a redacted
 * payload (subject + status transitions only - no body content, which is
 * PII). Email notifications are fire-and-forget through
 * `lib/notify/email.ts`.
 *
 * Abuse controls:
 *   - `contact_request.create` is fronted by a Route Handler
 *     `app/api/contact/create/route.ts` that runs Vercel BotID and a
 *     per-IP bucket *before* calling `sendContactRequest`. The PID
 *     mandates both gates at the C8 boundary.
 *   - Per-profile and per-thread rate limits are enforced by AFTER
 *     INSERT triggers added in migration 0009 (sql-fixer) which call
 *     `app.bump_rate_limit` in the private `app` schema. The triggers
 *     raise SQLSTATE P0001 with a `rate_limited:` message prefix that
 *     `isRateLimited` matches on.
 */

// ---------------------------------------------------------------- validators

const SUBJECT_MIN = 3;
const SUBJECT_MAX = 120;
const BODY_MIN = 10;
const BODY_MAX = 2000;
const NOTE_MAX = 2000;
const DURATION_MIN = 15;
const DURATION_MAX = 240;
const MEETING_MIN_LEAD_MS = 60 * 60 * 1000; // 1 hour
const POST_MIN = 1;
const POST_MAX = 2000;

function requireFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new ContactValidationError(`missing_${key}`);
  }
  return value;
}

function optionalFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function assertLen(
  value: string,
  min: number,
  max: number,
  field: string,
): void {
  if (value.length < min || value.length > max) {
    throw new ContactValidationError(
      `invalid_${field}`,
      `${field} must be between ${min} and ${max} characters`,
    );
  }
}

function normaliseNote(note: string | null): string | null {
  if (note === null) return null;
  // Sanitise first: notes end up in the email body and, for some flows,
  // are quoted into adjacent header-adjacent context. Strip CRLF / C0
  // controls as defense-in-depth (contact-findings C-7).
  const clean = sanitizeHeader(note);
  if (clean.length === 0) return null;
  if (clean.length > NOTE_MAX) {
    throw new ContactValidationError(
      "invalid_note",
      `note must be at most ${NOTE_MAX} characters`,
    );
  }
  return clean;
}

function parsePositiveInt(raw: string, field: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ContactValidationError(
      `invalid_${field}`,
      `${field} must be a positive whole number`,
    );
  }
  return parsed;
}

// ---------------------------------------------------------------- caller context

type Caller = {
  profileId: string;
  role: string;
  displayName: string | null;
  email: string | null;
};

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

async function loadCaller(): Promise<{
  supabase: ServerClient;
  caller: Caller;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new ContactValidationError("sign_in_required");
  }

  // Read the profile row through the user-scoped client. `profiles_self_read`
  // allows this for the own row; the column-level public grant would allow
  // id/role/display_name anyway. We need `role` + `display_name` + `email`
  // to audit and to include a friendly name in outbound emails.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new ContactValidationError("profile_not_found", error.message);
  }
  if (!profile) {
    throw new ContactValidationError("profile_not_found");
  }

  return {
    supabase,
    caller: {
      profileId: profile.id as string,
      role: profile.role as string,
      displayName: (profile.display_name as string | null) ?? null,
      email:
        (profile.email as string | null | undefined) ??
        user.email ??
        null,
    },
  };
}

function assertRoleIn(role: string, allowed: readonly string[]): void {
  if (!allowed.includes(role)) {
    throw new ContactValidationError("role_forbidden");
  }
}

// ---------------------------------------------------------------- rate-limit bridge

type SupabaseError = { code?: string | null; message?: string | null } | null;

function isRateLimited(error: SupabaseError): boolean {
  if (!error) return false;
  // `app.bump_rate_limit` raises P0001 with a `rate_limited:` message prefix
  // (migration 0009). Anchor the match so an unrelated P0001 whose message
  // happens to contain the substring does not masquerade as a rate-limit
  // error. See contact-findings L-3.
  if (error.code !== "P0001") return false;
  if (typeof error.message !== "string") return false;
  return /^rate_limited(?::|$|\s)/.test(error.message);
}

function isUniqueViolation(error: SupabaseError): boolean {
  // PostgreSQL SQLSTATE 23505 is surfaced by PostgREST unchanged.
  return Boolean(error && error.code === "23505");
}

async function recordAuditEventBestEffort(
  params: Parameters<typeof recordAuditEvent>[0],
): Promise<void> {
  // Audit writes are best-effort: the business mutation has already
  // committed, and a failing audit insert must NEVER bubble up and make
  // the user retry the action (which would duplicate the row). See
  // contact-findings H-5.
  try {
    await recordAuditEvent(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[audit] contact event not recorded (swallowed)", {
      action: params.action,
      subject_id: params.subjectId ?? null,
      error: message,
    });
  }
}

// ---------------------------------------------------------------- shared lookups

async function loadContactRequestForParty(
  supabase: ServerClient,
  contactRequestId: string,
): Promise<{
  id: string;
  receiver_id: string;
  provider_id: string;
  status: string;
}> {
  const { data, error } = await supabase
    .from("contact_requests")
    .select("id, receiver_id, provider_id, status")
    .eq("id", contactRequestId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new ContactValidationError("db_error", error.message);
  }
  if (!data) {
    throw new ContactValidationError("not_found");
  }
  return {
    id: data.id as string,
    receiver_id: data.receiver_id as string,
    provider_id: data.provider_id as string,
    status: data.status as string,
  };
}

async function lookupDisplayName(
  supabase: ServerClient,
  profileId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", profileId)
    .maybeSingle();
  return (data?.display_name as string | null | undefined) ?? null;
}

async function lookupEmail(profileId: string): Promise<string | null> {
  // SECURITY: `profiles.email` is owner-scoped under RLS, so the caller's
  // user-scoped client cannot read the counter-party's email - and three
  // of four C8 transactional emails need the counter-party's address.
  //
  // We use the service-role admin client for this single, scoped read.
  // This is a well-defined admin-boundary operation: fetch exactly one
  // email by primary key for a notification that the Server Action has
  // ALREADY authorised (the caller is a known party to the contact
  // request and has passed every role/RLS/guard check before we reach
  // this point). We never enumerate or list emails from this code path.
  //
  // Do NOT expand this helper to accept filters, batch IDs, or column
  // lists. Any additional use of the admin client must be reviewed
  // against the C8 RLS boundary. See contact-findings C-5.
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .maybeSingle();
  return (data?.email as string | null | undefined) ?? null;
}

// ---------------------------------------------------------------- 1. sendContactRequest

/**
 * Create a contact request. Returns the new row id so the Route Handler
 * that fronts this (with BotID + per-IP rate limit) can emit an HTTP
 * redirect. Does NOT call `redirect()` directly - the abuse-control
 * boundary owns the response shape.
 */
export async function sendContactRequest(
  formData: FormData,
): Promise<{ contactRequestId: string }> {
  // Sanitise header-bearing inputs BEFORE length checks: a payload that
  // smuggles CRLF must either be rejected or stripped, and length alone
  // is not sufficient (contact-findings C-7).
  const subject = sanitizeHeader(requireFormString(formData, "subject"));
  const body = requireFormString(formData, "body").trim();
  const providerId = requireFormString(formData, "provider_id").trim();
  assertLen(subject, SUBJECT_MIN, SUBJECT_MAX, "subject");
  assertLen(body, BODY_MIN, BODY_MAX, "body");

  const { supabase, caller } = await loadCaller();
  assertRoleIn(caller.role, ["receiver", "family_member"]);

  // First-line check: fetch the provider profile through the public RLS
  // policy (`provider_profiles_public_read`, verified + not soft-deleted).
  const { data: provider, error: providerError } = await supabase
    .from("provider_profiles")
    .select("id, headline, verified_at, deleted_at")
    .eq("id", providerId)
    .maybeSingle();

  if (providerError) {
    throw new ContactValidationError("db_error", providerError.message);
  }
  if (
    !provider ||
    provider.verified_at === null ||
    provider.deleted_at !== null
  ) {
    throw new ContactValidationError("provider_not_available");
  }

  // Per-profile rate-limit enforcement: the AFTER INSERT trigger
  // `tg_contact_requests_rate_limit` (migration 0009) calls
  // `app.bump_rate_limit('contact_request.create', ...)` and raises
  // P0001 `rate_limited:` on trip; `isRateLimited` below translates it.
  const { data: inserted, error: insertError } = await supabase
    .from("contact_requests")
    .insert({
      receiver_id: caller.profileId,
      provider_id: providerId,
      subject,
      body,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (isRateLimited(insertError)) {
      throw new ContactValidationError("rate_limited");
    }
    throw new ContactValidationError(
      "db_error",
      insertError?.message ?? "insert failed",
    );
  }

  const contactRequestId = inserted.id as string;

  await recordAuditEventBestEffort({
    action: "contact_request.create",
    subjectTable: "public.contact_requests",
    subjectId: contactRequestId,
    // Redacted: `body` is PII, and `subject` is user-supplied prose that
    // can contain PII too ("Care for my mother Jane Smith"). Per the PID
    // PII-redaction posture we log only the length, not the content.
    // See contact-findings M-5.
    after: {
      subject_length: subject.length,
      status: "pending",
      provider_id: providerId,
    },
  });

  const providerEmail = await lookupEmail(providerId);
  const template = contactRequestToProvider({
    receiverName: caller.displayName,
    subject,
  });
  await sendEmail({
    to: providerEmail ?? "",
    subject: template.subject,
    body: template.body,
    role: "provider",
  });

  return { contactRequestId };
}

// ---------------------------------------------------------------- 2. withdrawContactRequest

export async function withdrawContactRequest(id: string): Promise<void> {
  if (!id) {
    throw new ContactValidationError("missing_id");
  }

  const { supabase, caller } = await loadCaller();

  const existing = await loadContactRequestForParty(supabase, id);
  if (existing.receiver_id !== caller.profileId) {
    throw new ContactValidationError("forbidden");
  }

  // tg_contact_requests_guard will reject any transition other than
  // pending->withdrawn for a receiver, so we let the DB be the referee.
  const { error } = await supabase
    .from("contact_requests")
    .update({ status: "withdrawn" })
    .eq("id", id);

  if (error) {
    if (error.code === "42501") {
      throw new ContactValidationError("invalid_transition", error.message);
    }
    throw new ContactValidationError("db_error", error.message);
  }

  await recordAuditEventBestEffort({
    action: "contact_request.withdraw",
    subjectTable: "public.contact_requests",
    subjectId: id,
    before: { status: existing.status },
    after: { status: "withdrawn" },
  });
}

// ---------------------------------------------------------------- 3. respondToContactRequest

export async function respondToContactRequest(
  id: string,
  decision: ContactResponseDecision,
  note: string | null,
): Promise<void> {
  if (!id) {
    throw new ContactValidationError("missing_id");
  }
  if (!isContactResponseDecision(decision)) {
    throw new ContactValidationError("invalid_decision");
  }
  const cleanNote = normaliseNote(note);

  const { supabase, caller } = await loadCaller();
  // `provider_company` is intentionally NOT on the allow-list until
  // `app.is_company_member` lands in C3b. Today `contact_requests.provider_id`
  // references an individual `provider_profiles.id`, so a company-account
  // caller would always fail the party check below with a confusing
  // 42501 from the guard trigger. Drop them here for a friendly error.
  // See contact-findings H-6.
  assertRoleIn(caller.role, ["provider"]);

  const existing = await loadContactRequestForParty(supabase, id);
  if (existing.provider_id !== caller.profileId) {
    throw new ContactValidationError("forbidden");
  }

  const { error } = await supabase
    .from("contact_requests")
    .update({
      status: decision,
      response_note: cleanNote,
    })
    .eq("id", id);

  if (error) {
    if (error.code === "42501") {
      throw new ContactValidationError("invalid_transition", error.message);
    }
    throw new ContactValidationError("db_error", error.message);
  }

  await recordAuditEventBestEffort({
    action: "contact_request.respond",
    subjectTable: "public.contact_requests",
    subjectId: id,
    before: { status: existing.status },
    after: { status: decision },
  });

  const receiverEmail = await lookupEmail(existing.receiver_id);
  const template = contactResponseToReceiver({
    providerName: caller.displayName,
    decision,
    note: cleanNote,
  });
  await sendEmail({
    to: receiverEmail ?? "",
    subject: template.subject,
    body: template.body,
    role: "receiver",
  });
}

// ---------------------------------------------------------------- 4. proposeMeeting

export async function proposeMeeting(formData: FormData): Promise<void> {
  const contactRequestId = requireFormString(formData, "contact_request_id").trim();
  const meetingAtRaw = requireFormString(formData, "meeting_at").trim();
  const durationRaw = requireFormString(formData, "duration_minutes").trim();
  const locationModeRaw = requireFormString(formData, "location_mode").trim();
  const locationDetailRaw = optionalFormString(formData, "location_detail");
  // Sanitise + trim so a whitespace-only or CRLF-laden location_detail
  // does not sneak into the DB or the outbound email (contact-findings
  // M-3 and C-7).
  const locationDetailClean = locationDetailRaw
    ? sanitizeHeader(locationDetailRaw)
    : null;
  const locationDetail =
    locationDetailClean && locationDetailClean.length > 0
      ? locationDetailClean
      : null;

  if (!isLocationMode(locationModeRaw)) {
    throw new ContactValidationError("invalid_location_mode");
  }
  const locationMode: LocationMode = locationModeRaw;

  const durationMinutes = parsePositiveInt(durationRaw, "duration_minutes");
  if (durationMinutes < DURATION_MIN || durationMinutes > DURATION_MAX) {
    throw new ContactValidationError(
      "invalid_duration_minutes",
      `duration_minutes must be between ${DURATION_MIN} and ${DURATION_MAX}`,
    );
  }

  const meetingAt = new Date(meetingAtRaw);
  if (Number.isNaN(meetingAt.getTime())) {
    throw new ContactValidationError("invalid_meeting_at");
  }
  if (meetingAt.getTime() < Date.now() + MEETING_MIN_LEAD_MS) {
    throw new ContactValidationError(
      "invalid_meeting_at",
      "meeting_at must be at least one hour in the future",
    );
  }

  const { supabase, caller } = await loadCaller();
  // `provider_company` is excluded until `app.is_company_member` ships in
  // C3b - same rationale as respondToContactRequest above (H-6).
  assertRoleIn(caller.role, ["receiver", "family_member", "provider"]);

  const existing = await loadContactRequestForParty(supabase, contactRequestId);
  const isReceiverSide = existing.receiver_id === caller.profileId;
  const isProviderSide = existing.provider_id === caller.profileId;
  if (!isReceiverSide && !isProviderSide) {
    throw new ContactValidationError("forbidden");
  }
  if (existing.status !== "accepted") {
    throw new ContactValidationError("invalid_transition");
  }

  // Per-profile rate-limit enforcement: the AFTER INSERT trigger
  // `tg_meeting_proposals_rate_limit` (migration 0009) calls
  // `app.bump_rate_limit('meeting_proposal.create', ...)` and raises
  // P0001 `rate_limited:` on trip.
  const { data: inserted, error: insertError } = await supabase
    .from("meeting_proposals")
    .insert({
      contact_request_id: contactRequestId,
      proposed_by: caller.profileId,
      meeting_at: meetingAt.toISOString(),
      duration_minutes: durationMinutes,
      location_mode: locationMode,
      location_detail: locationDetail,
      status: "proposed",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (isRateLimited(insertError)) {
      throw new ContactValidationError("rate_limited");
    }
    throw new ContactValidationError(
      "db_error",
      insertError?.message ?? "insert failed",
    );
  }

  const proposalId = inserted.id as string;

  await recordAuditEventBestEffort({
    action: "meeting.propose",
    subjectTable: "public.meeting_proposals",
    subjectId: proposalId,
    after: {
      contact_request_id: contactRequestId,
      status: "proposed",
      location_mode: locationMode,
      // `meeting_at` and duration are scheduling metadata, not PII, and
      // are safe to keep for the W2 trail.
      meeting_at: meetingAt.toISOString(),
      duration_minutes: durationMinutes,
    },
  });

  const otherPartyId = isReceiverSide
    ? existing.provider_id
    : existing.receiver_id;
  const otherPartyRole: EmailRole = isReceiverSide ? "provider" : "receiver";
  const otherEmail = await lookupEmail(otherPartyId);
  const proposerName = caller.displayName;
  const template = meetingProposedTo({
    proposerName,
    meetingAt: meetingAt.toISOString(),
    locationMode,
  });
  await sendEmail({
    to: otherEmail ?? "",
    subject: template.subject,
    body: template.body,
    role: otherPartyRole,
  });
}

// ---------------------------------------------------------------- 5. respondToMeeting

export async function respondToMeeting(
  id: string,
  decision: MeetingDecision,
  note: string | null,
): Promise<void> {
  if (!id) {
    throw new ContactValidationError("missing_id");
  }
  if (!isMeetingDecision(decision)) {
    throw new ContactValidationError("invalid_decision");
  }
  const cleanNote = normaliseNote(note);

  const { supabase, caller } = await loadCaller();
  // `provider_company` excluded until `app.is_company_member` ships (H-6).
  assertRoleIn(caller.role, ["receiver", "family_member", "provider"]);

  const { data: proposal, error: proposalError } = await supabase
    .from("meeting_proposals")
    .select(
      "id, contact_request_id, proposed_by, meeting_at, status, contact_requests!inner(receiver_id, provider_id)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (proposalError) {
    throw new ContactValidationError("db_error", proposalError.message);
  }
  if (!proposal) {
    throw new ContactValidationError("not_found");
  }

  const nested = proposal.contact_requests as
    | { receiver_id: string; provider_id: string }
    | Array<{ receiver_id: string; provider_id: string }>;
  const parent = Array.isArray(nested) ? nested[0] : nested;
  if (!parent) {
    throw new ContactValidationError("not_found");
  }

  const receiverId = parent.receiver_id;
  const providerId = parent.provider_id;
  const isReceiverSide = receiverId === caller.profileId;
  const isProviderSide = providerId === caller.profileId;
  if (!isReceiverSide && !isProviderSide) {
    throw new ContactValidationError("forbidden");
  }

  const { error: updateError } = await supabase
    .from("meeting_proposals")
    .update({ status: decision, response_note: cleanNote })
    .eq("id", id);

  if (updateError) {
    if (updateError.code === "42501") {
      throw new ContactValidationError("invalid_transition", updateError.message);
    }
    // 23505 from the partial unique index `meeting_proposals_one_accepted_idx`
    // (migration 0009): another proposal under the same contact_request is
    // already `accepted`. Surface as a friendly, stable code so the UI can
    // explain the race instead of "database error". See contact-findings H-8.
    if (isUniqueViolation(updateError)) {
      throw new ContactValidationError("meeting_already_accepted");
    }
    throw new ContactValidationError("db_error", updateError.message);
  }

  await recordAuditEventBestEffort({
    action: "meeting.respond",
    subjectTable: "public.meeting_proposals",
    subjectId: id,
    before: { status: proposal.status as string },
    after: { status: decision },
  });

  const otherPartyId = isReceiverSide ? providerId : receiverId;
  const otherPartyRole: EmailRole = isReceiverSide ? "provider" : "receiver";
  const otherEmail = await lookupEmail(otherPartyId);
  const template = meetingResponseTo({
    decision,
    meetingAt: proposal.meeting_at as string,
    note: cleanNote,
  });
  await sendEmail({
    to: otherEmail ?? "",
    subject: template.subject,
    body: template.body,
    role: otherPartyRole,
  });
}

// ---------------------------------------------------------------- 6. postToThread

export async function postToThread(
  threadId: string,
  body: string,
): Promise<void> {
  if (!threadId) {
    throw new ContactValidationError("missing_thread_id");
  }
  const trimmed = body?.trim() ?? "";
  if (trimmed.length < POST_MIN || trimmed.length > POST_MAX) {
    throw new ContactValidationError(
      "invalid_body",
      `post body must be between ${POST_MIN} and ${POST_MAX} characters`,
    );
  }

  const { supabase, caller } = await loadCaller();

  // Verify the caller is a party to the thread's underlying contact
  // request before we attempt the insert. RLS will enforce the same,
  // but the pre-check gives us a friendlier error code and lets us
  // correlate the audit event to the right request.
  const { data: thread, error: threadError } = await supabase
    .from("contact_threads")
    .select(
      "id, contact_request_id, contact_requests!inner(receiver_id, provider_id, status)",
    )
    .eq("id", threadId)
    .is("deleted_at", null)
    .maybeSingle();

  if (threadError) {
    throw new ContactValidationError("db_error", threadError.message);
  }
  if (!thread) {
    throw new ContactValidationError("not_found");
  }

  const nested = thread.contact_requests as
    | { receiver_id: string; provider_id: string; status: string }
    | Array<{ receiver_id: string; provider_id: string; status: string }>;
  const parent = Array.isArray(nested) ? nested[0] : nested;
  if (!parent) {
    throw new ContactValidationError("not_found");
  }
  if (parent.status !== "accepted") {
    throw new ContactValidationError("invalid_transition");
  }
  if (
    parent.receiver_id !== caller.profileId &&
    parent.provider_id !== caller.profileId
  ) {
    throw new ContactValidationError("forbidden");
  }

  // The AFTER INSERT trigger `tg_contact_thread_posts_rate_limit`
  // (migration 0009, moved from BEFORE INSERT to avoid debiting a bucket
  // for an RLS-rejected insert) calls `app.bump_rate_limit` with a
  // per-thread scope key (`thread_post.create:<thread_id>`). On trip it
  // raises P0001 `rate_limited:`; we translate that to a stable
  // client-facing code. See contact-findings C-6 and H-3.
  const { error: insertError } = await supabase
    .from("contact_thread_posts")
    .insert({
      thread_id: threadId,
      author_id: caller.profileId,
      body: trimmed,
    });

  if (insertError) {
    if (isRateLimited(insertError)) {
      throw new ContactValidationError("rate_limited");
    }
    throw new ContactValidationError("db_error", insertError.message);
  }

  await recordAuditEventBestEffort({
    action: "thread_post.create",
    subjectTable: "public.contact_thread_posts",
    subjectId: threadId,
    // Redacted: the `body` is PII and is NOT logged. We capture only
    // the thread id and parent contact_request id for correlation.
    after: {
      thread_id: threadId,
      contact_request_id: thread.contact_request_id as string,
    },
  });

  // Email digest to the other party is deferred per the task brief.
}
