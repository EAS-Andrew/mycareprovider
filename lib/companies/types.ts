/**
 * Non-async exports for the companies module. `lib/companies/actions.ts` is
 * a `"use server"` file, so type aliases live here so form components can
 * import them without crossing the "use server" boundary.
 */

export type CompanyProfileRow = {
  id: string;
  company_name: string;
  company_number: string | null;
  registered_address: string | null;
  service_postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  description: string | null;
  website: string | null;
  phone: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MembershipRole = "owner" | "admin" | "member";

export type CompanyMemberRow = {
  id: string;
  company_id: string;
  provider_id: string;
  role: MembershipRole;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  removed_at: string | null;
  provider_display_name: string | null;
};
