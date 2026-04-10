/**
 * Non-async exports for the care-circles module. `actions.ts` is a
 * `"use server"` file so constants and type aliases live here.
 */

export const RECEIVER_DOCS_BUCKET = "receiver-docs";

export const AUTHORISATION_TYPES = [
  "power_of_attorney",
  "legal_guardian",
  "deputyship",
  "other",
] as const;

export type AuthorisationType = (typeof AUTHORISATION_TYPES)[number];

export function isAuthorisationType(
  value: string,
): value is AuthorisationType {
  return (AUTHORISATION_TYPES as readonly string[]).includes(value);
}

export const AUTHORISATION_LABELS: Record<AuthorisationType, string> = {
  power_of_attorney: "Power of Attorney",
  legal_guardian: "Legal Guardian",
  deputyship: "Deputyship",
  other: "Other",
};

export type CareCircleRole = "primary" | "member";

export type CareCircleRow = {
  id: string;
  receiver_id: string;
  name: string;
  created_at: string;
};

export type CareCircleMemberRow = {
  id: string;
  circle_id: string;
  profile_id: string;
  role: CareCircleRole;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  removed_at: string | null;
  display_name: string | null;
  email: string | null;
};

export type FamilyAuthorisationRow = {
  id: string;
  circle_member_id: string;
  document_id: string;
  authorisation_type: AuthorisationType;
  granted_at: string;
  expires_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  notes: string | null;
  created_at: string;
  document_title: string | null;
  document_status: string | null;
};

export type FamilyInvitationRow = {
  id: string;
  circle_id: string;
  email: string;
  role: CareCircleRole;
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};
