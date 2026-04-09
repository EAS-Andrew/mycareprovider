"use server";

import { redirect } from "next/navigation";

import {
  postToThread,
  proposeMeeting,
  respondToMeeting,
  withdrawContactRequest,
} from "@/lib/contact/actions";
import {
  ContactValidationError,
  isMeetingDecision,
} from "@/lib/contact/types";

/**
 * Trampoline Server Actions for the receiver-side C8 UI.
 *
 * Every action below wraps a typed action from `lib/contact/actions.ts` in
 * a FormData-friendly shape and converts `ContactValidationError` instances
 * into a `?error=<message>` redirect so the page can render them through the
 * shared error-summary block. Matches the `submitProviderProfile` trampoline
 * pattern in `app/(provider)/provider/onboarding/actions.ts`.
 *
 * These are deliberately duplicated between the receiver and provider route
 * groups - cross-group imports are a review-blocker per the Brand & theming
 * rule in docs/pid.md, and the two sides have slightly different redirect
 * targets anyway.
 */

function isRedirectError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function errorMessageFor(err: unknown): string {
  if (err instanceof ContactValidationError) {
    return humaniseCode(err.code);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Something went wrong";
}

function humaniseCode(code: string): string {
  switch (code) {
    case "sign_in_required":
      return "Please sign in to continue.";
    case "role_forbidden":
      return "Your account cannot perform this action.";
    case "provider_not_available":
      return "That provider is not accepting contact requests right now.";
    case "not_found":
      return "That contact request could not be found.";
    case "forbidden":
      return "You are not allowed to update this contact request.";
    case "invalid_transition":
      return "That status change is not allowed.";
    case "rate_limited":
      return "You are sending messages too quickly. Please wait a moment and try again.";
    case "meeting_already_accepted":
      return "Another meeting has already been accepted for this request.";
    case "invalid_subject":
      return "Subject must be between 3 and 120 characters.";
    case "invalid_body":
      return "Message must be between 10 and 2000 characters.";
    case "missing_subject":
      return "Please enter a subject.";
    case "missing_body":
      return "Please enter a message.";
    case "missing_provider_id":
      return "A provider must be selected.";
    case "invalid_meeting_at":
      return "Please choose a meeting time at least one hour from now.";
    case "invalid_duration_minutes":
      return "Meeting length must be between 15 and 240 minutes.";
    case "invalid_location_mode":
      return "Please choose how the meeting will take place.";
    case "invalid_decision":
      return "Please choose a valid response.";
    case "invalid_note":
      return "Note is too long.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function requireString(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || v.length === 0) {
    throw new ContactValidationError(`missing_${key}`);
  }
  return v;
}

function optionalString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

// `submitContactRequest` used to live here, but contact-request creation
// now flows through the `app/api/contact/create/route.ts` Route Handler so
// the BotID and per-IP rate-limit gates can run before any server logic.

/**
 * Withdraw a pending contact request. Receiver-only. Redirects back to the
 * detail page; on error, surfaces through `?error=`.
 */
export async function withdrawContactRequestAction(
  formData: FormData,
): Promise<void> {
  const id = requireString(formData, "id").trim();
  try {
    await withdrawContactRequest(id);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(
      `/receiver/contacts/${id}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(`/receiver/contacts/${id}?notice=${encodeURIComponent("Contact request withdrawn.")}`);
}

/**
 * Propose a meeting from the receiver side. The underlying action takes the
 * FormData directly; we only need the trampoline for error-to-`?error=`
 * translation and for the success redirect back to the detail page.
 */
export async function proposeMeetingAction(
  formData: FormData,
): Promise<void> {
  const contactRequestId = requireString(formData, "contact_request_id").trim();
  try {
    await proposeMeeting(formData);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(
      `/receiver/contacts/${contactRequestId}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(
    `/receiver/contacts/${contactRequestId}?notice=${encodeURIComponent("Meeting proposed.")}`,
  );
}

/**
 * Accept, decline, or cancel a meeting proposal. Uses the `id`, `decision`,
 * and (optional) `note` form fields, plus a `contact_request_id` hidden
 * field used only as a redirect target.
 */
export async function respondToMeetingAction(
  formData: FormData,
): Promise<void> {
  const contactRequestId = requireString(formData, "contact_request_id").trim();
  const id = requireString(formData, "id").trim();
  const decisionRaw = requireString(formData, "decision").trim();
  const note = optionalString(formData, "note");
  if (!isMeetingDecision(decisionRaw)) {
    redirect(
      `/receiver/contacts/${contactRequestId}?error=${encodeURIComponent("Please choose a valid response.")}`,
    );
  }
  try {
    await respondToMeeting(id, decisionRaw, note);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(
      `/receiver/contacts/${contactRequestId}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(`/receiver/contacts/${contactRequestId}`);
}

/**
 * Post a message to a contact thread. The form hidden fields include
 * `thread_id` and `contact_request_id` (the latter is used only for the
 * redirect target).
 */
export async function postToThreadAction(formData: FormData): Promise<void> {
  const contactRequestId = requireString(formData, "contact_request_id").trim();
  const threadId = requireString(formData, "thread_id").trim();
  const body = requireString(formData, "body");
  try {
    await postToThread(threadId, body);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(
      `/receiver/contacts/${contactRequestId}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(`/receiver/contacts/${contactRequestId}`);
}
