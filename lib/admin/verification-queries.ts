import "server-only";

import { getCurrentRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Throws if the caller is not an admin. Returns the user-scoped Supabase
 * client for follow-up queries that need RLS context.
 */
async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("sign-in-required");

  const role = await getCurrentRole(supabase, user);
  if (role !== "admin") throw new Error("admin-required");

  return supabase;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export type VerificationStats = {
  pendingDocuments: number;
  pendingProviders: number;
  pendingCompanies: number;
  pendingFamilyAuthorisations: number;
};

export async function getVerificationStats(): Promise<VerificationStats> {
  const supabase = await requireAdmin();

  const [docs, providers, companies, familyAuths] = await Promise.all([
    supabase
      .from("verifications")
      .select("id", { count: "exact", head: true })
      .in("state", ["pending", "in_review"]),
    supabase
      .from("provider_profiles")
      .select("id", { count: "exact", head: true })
      .is("verified_at", null)
      .is("deleted_at", null),
    supabase
      .from("provider_companies")
      .select("id", { count: "exact", head: true })
      .is("verified_at", null)
      .is("deleted_at", null),
    supabase
      .from("family_authorisations")
      .select("id", { count: "exact", head: true })
      .is("verified_at", null)
      .is("deleted_at", null),
  ]);

  return {
    pendingDocuments: docs.count ?? 0,
    pendingProviders: providers.count ?? 0,
    pendingCompanies: companies.count ?? 0,
    pendingFamilyAuthorisations: familyAuths.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Pending document verifications
// ---------------------------------------------------------------------------

export type PendingVerification = {
  id: string;
  state: string;
  notes: string | null;
  created_at: string;
  document: {
    id: string;
    kind: string;
    title: string;
    status: string;
    provider_id: string | null;
    provider_company_id: string | null;
    receiver_id: string | null;
    created_at: string;
  };
};

export async function getPendingVerifications(): Promise<PendingVerification[]> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("verifications")
    .select(
      `id, state, notes, created_at,
       document:documents!inner(id, kind, title, status, provider_id, provider_company_id, receiver_id, created_at)`,
    )
    .in("state", ["pending", "in_review"])
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PendingVerification[];
}

// ---------------------------------------------------------------------------
// Single document for review
// ---------------------------------------------------------------------------

export type DocumentForReview = {
  id: string;
  state: string;
  notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  document: {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    status: string;
    mime_type: string;
    size_bytes: number;
    storage_bucket: string;
    storage_path: string;
    expires_at: string | null;
    provider_id: string | null;
    provider_company_id: string | null;
    receiver_id: string | null;
    created_at: string;
  };
};

export async function getDocumentForReview(
  verificationId: string,
): Promise<DocumentForReview | null> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("verifications")
    .select(
      `id, state, notes, reviewed_by, reviewed_at, created_at,
       document:documents!inner(id, kind, title, description, status, mime_type, size_bytes, storage_bucket, storage_path, expires_at, provider_id, provider_company_id, receiver_id, created_at)`,
    )
    .eq("id", verificationId)
    .single();

  if (error) return null;
  return data as unknown as DocumentForReview;
}

// ---------------------------------------------------------------------------
// Pending providers (unverified)
// ---------------------------------------------------------------------------

export type PendingProvider = {
  id: string;
  headline: string | null;
  city: string | null;
  postcode: string | null;
  created_at: string;
  profile: { display_name: string | null; email: string | null } | null;
};

export async function getPendingProviders(): Promise<PendingProvider[]> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("provider_profiles")
    .select(
      `id, headline, city, postcode, created_at,
       profile:profiles!inner(display_name, email)`,
    )
    .is("verified_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PendingProvider[];
}

// ---------------------------------------------------------------------------
// Single provider for review
// ---------------------------------------------------------------------------

export type ProviderForReview = {
  id: string;
  headline: string | null;
  bio: string | null;
  city: string | null;
  postcode: string | null;
  years_experience: number | null;
  hourly_rate_pence: number | null;
  verified_at: string | null;
  created_at: string;
  profile: { display_name: string | null; email: string | null } | null;
};

export async function getProviderForReview(
  providerId: string,
): Promise<ProviderForReview | null> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("provider_profiles")
    .select(
      `id, headline, bio, city, postcode, years_experience, hourly_rate_pence, verified_at, created_at,
       profile:profiles!inner(display_name, email)`,
    )
    .eq("id", providerId)
    .is("deleted_at", null)
    .single();

  if (error) return null;
  return data as unknown as ProviderForReview;
}

export async function getProviderDocuments(providerId: string) {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("documents")
    .select(
      `id, kind, title, status, mime_type, created_at,
       verification:verifications(id, state, notes, reviewed_at)`,
    )
    .eq("provider_id", providerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Pending companies (unverified)
// ---------------------------------------------------------------------------

export type PendingCompany = {
  id: string;
  company_name: string;
  company_number: string | null;
  service_postcode: string | null;
  created_at: string;
};

export async function getPendingCompanies(): Promise<PendingCompany[]> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("provider_companies")
    .select("id, company_name, company_number, service_postcode, created_at")
    .is("verified_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as PendingCompany[];
}

// ---------------------------------------------------------------------------
// Single company for review
// ---------------------------------------------------------------------------

export type CompanyForReview = {
  id: string;
  company_name: string;
  company_number: string | null;
  registered_address: string | null;
  service_postcode: string | null;
  description: string | null;
  website: string | null;
  phone: string | null;
  verified_at: string | null;
  created_at: string;
};

export async function getCompanyForReview(
  companyId: string,
): Promise<CompanyForReview | null> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("provider_companies")
    .select(
      "id, company_name, company_number, registered_address, service_postcode, description, website, phone, verified_at, created_at",
    )
    .eq("id", companyId)
    .is("deleted_at", null)
    .single();

  if (error) return null;
  return data as CompanyForReview;
}

export async function getCompanyDocuments(companyId: string) {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("documents")
    .select(
      `id, kind, title, status, mime_type, created_at,
       verification:verifications(id, state, notes, reviewed_at)`,
    )
    .eq("provider_company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Pending family authorisations (unverified)
// ---------------------------------------------------------------------------

export type PendingFamilyAuthorisation = {
  id: string;
  authorisation_type: string;
  granted_at: string;
  notes: string | null;
  created_at: string;
  document: { id: string; kind: string; title: string; status: string } | null;
};

export async function getPendingFamilyAuthorisations(): Promise<
  PendingFamilyAuthorisation[]
> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("family_authorisations")
    .select(
      `id, authorisation_type, granted_at, notes, created_at,
       document:documents(id, kind, title, status)`,
    )
    .is("verified_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PendingFamilyAuthorisation[];
}

// ---------------------------------------------------------------------------
// Single family authorisation for review
// ---------------------------------------------------------------------------

export type FamilyAuthorisationForReview = {
  id: string;
  authorisation_type: string;
  granted_at: string;
  expires_at: string | null;
  notes: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  document: {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    status: string;
    mime_type: string;
    storage_bucket: string;
    storage_path: string;
    created_at: string;
  } | null;
};

export async function getFamilyAuthorisationForReview(
  authorisationId: string,
): Promise<FamilyAuthorisationForReview | null> {
  const supabase = await requireAdmin();

  const { data, error } = await supabase
    .from("family_authorisations")
    .select(
      `id, authorisation_type, granted_at, expires_at, notes, verified_at, verified_by, created_at,
       document:documents(id, kind, title, description, status, mime_type, storage_bucket, storage_path, created_at)`,
    )
    .eq("id", authorisationId)
    .is("deleted_at", null)
    .single();

  if (error) return null;
  return data as unknown as FamilyAuthorisationForReview;
}
