"use server";

import { redirect } from "next/navigation";

import {
  postToThread,
  proposeMeeting,
  respondToContactRequest,
  respondToMeeting,
} from "@/lib/contact/actions";
import {
  ContactValidationError,
  isContactResponseDecision,
  isMeetingDecision,
} from "@/lib/contact/types";

/**
 * Trampoline Server Actions for the provider-side C8 UI.
 *
 * Deliberately duplicated from the receiver side rather than shared: cross
 * route-group imports are a review-blocker per the Brand & theming rule,
 * and the redirect targets differ between the two sides.
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
    case "invalid_body":
      return "Message must be between 1 and 2000 characters.";
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

/**
 * Accept or decline an incoming contact request. Form fields: `id`,
 * `decision`, `note` (optional).
 */
export async function respondToContactRequestAction(
  formData: FormData,
): Promise<void> {
  const id = requireString(formData, "id").trim();
  const decisionRaw = requireString(formData, "decision").trim();
  const note = optionalString(formData, "note");
  if (!isContactResponseDecision(decisionRaw)) {
    redirect(
      `/provider/contacts/${id}?error=${encodeURIComponent("Please choose a valid response.")}`,
    );
  }
  try {
    await respondToContactRequest(id, decisionRaw, note);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(
      `/provider/contacts/${id}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(`/provider/contacts/${id}`);
}

/**
 * Propose a meeting from the provider side. Passes the FormData straight
 * through to the typed action.
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
      `/provider/contacts/${contactRequestId}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(
    `/provider/contacts/${contactRequestId}?notice=${encodeURIComponent("Meeting proposed.")}`,
  );
}

/**
 * Accept, decline, or cancel a meeting proposal from the provider side.
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
      `/provider/contacts/${contactRequestId}?error=${encodeURIComponent("Please choose a valid response.")}`,
    );
  }
  try {
    await respondToMeeting(id, decisionRaw, note);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(
      `/provider/contacts/${contactRequestId}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(`/provider/contacts/${contactRequestId}`);
}

/**
 * Post a message to a contact thread from the provider side.
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
      `/provider/contacts/${contactRequestId}?error=${encodeURIComponent(errorMessageFor(err))}`,
    );
  }
  redirect(`/provider/contacts/${contactRequestId}`);
}
