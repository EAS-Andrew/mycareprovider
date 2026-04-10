/**
 * Whitelisted enum of error codes that may appear in auth flow query params.
 * We deliberately never echo raw Supabase error messages back to the user -
 * they can leak implementation detail and are a poor UX. See finding auth#11.
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "rate_limited"
  | "admin_required"
  | "missing_field"
  | "unknown";

export function classifyAuthError(message: string | undefined): AuthErrorCode {
  if (!message) return "unknown";
  const lower = message.toLowerCase();
  if (
    lower.includes("invalid login") ||
    lower.includes("invalid credentials") ||
    lower.includes("email not confirmed")
  ) {
    return "invalid_credentials";
  }
  if (
    lower.includes("already registered") ||
    lower.includes("already been registered") ||
    lower.includes("user already")
  ) {
    return "email_taken";
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return "rate_limited";
  }
  return "unknown";
}
