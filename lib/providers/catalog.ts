import "server-only";

import { createServerClient } from "@/lib/supabase/server";

import type { ProviderProfileRow } from "./types";

/**
 * C6a read helpers for the services / capabilities / certifications catalog
 * and the caller's selection against it. Non-async exports (types, error
 * classes) live here so `lib/providers/profile-actions.ts` (a "use server"
 * module) can import them without violating the use-server export rules.
 *
 * All queries go through `createServerClient()` - reference tables are
 * world-readable and linking tables enforce owner RLS, so the user-scoped
 * client is the only boundary we need. No admin client in this module.
 */

export type ServiceCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
};

export type Capability = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  service_category_id: string | null;
};

export type Certification = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  expires: boolean;
};

export type ProviderCertificationRow = {
  id: string;
  certification_id: string;
  certification: Certification | null;
  reference: string | null;
  issued_on: string | null;
  expires_on: string | null;
  document_id: string | null;
  document_title: string | null;
  created_at: string;
  updated_at: string;
};

export type ProviderCatalogSelection = {
  profile: ProviderProfileRow | null;
  serviceCategoryIds: string[];
  capabilityIds: string[];
  certifications: ProviderCertificationRow[];
};

export type AddCertificationInput = {
  certificationId: string;
  reference?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  documentId?: string | null;
};

export type UpdateCertificationInput = {
  reference?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  documentId?: string | null;
};

/**
 * Thrown by profile-actions when form input fails validation or references
 * an entity the caller does not own. The trampoline catches these and
 * surfaces `.message` via `?error=` in the shared error-summary shape.
 * `code` lets callers branch programmatically without matching on prose.
 */
export class CatalogValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CatalogValidationError";
    this.code = code;
  }
}

export async function listServiceCategories(): Promise<ServiceCategory[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("service_categories")
    .select("id, slug, name, description, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    throw new Error(`listServiceCategories: ${error.message}`);
  }
  return (data ?? []) as ServiceCategory[];
}

export async function listCapabilities(): Promise<Capability[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("capabilities")
    .select("id, slug, name, description, sort_order, service_category_id")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    throw new Error(`listCapabilities: ${error.message}`);
  }
  return (data ?? []) as Capability[];
}

export async function listCertifications(): Promise<Certification[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("certifications")
    .select("id, slug, name, description, sort_order, expires")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    throw new Error(`listCertifications: ${error.message}`);
  }
  return (data ?? []) as Certification[];
}

type CertificationJoinRow = {
  id: string;
  certification_id: string;
  reference: string | null;
  issued_on: string | null;
  expires_on: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
  certification:
    | Certification
    | Certification[]
    | null;
  document:
    | { id: string; title: string }
    | Array<{ id: string; title: string }>
    | null;
};

/**
 * Returns the caller-owned catalog selection. Uses owner RLS policies so the
 * result is limited to rows where `provider_id = auth.uid()`. Three parallel
 * selects: the profile row, the two composite-PK linking tables, and the
 * non-soft-deleted `provider_certifications` joined onto the reference table
 * and the optional linked document.
 */
export async function getProviderProfileWithCatalog(
  profileId: string,
): Promise<ProviderCatalogSelection> {
  const supabase = await createServerClient();

  const [profileRes, servicesRes, capabilitiesRes, certsRes] = await Promise.all([
    supabase
      .from("provider_profiles")
      .select(
        "id, headline, bio, date_of_birth, phone, address_line1, address_line2, city, postcode, country, years_experience, hourly_rate_pence, service_postcode, service_radius_km, latitude, longitude, geocoded_at, verified_at, created_at, updated_at, deleted_at",
      )
      .eq("id", profileId)
      .maybeSingle(),
    supabase
      .from("provider_services")
      .select("service_category_id")
      .eq("provider_id", profileId),
    supabase
      .from("provider_capabilities")
      .select("capability_id")
      .eq("provider_id", profileId),
    supabase
      .from("provider_certifications")
      .select(
        "id, certification_id, reference, issued_on, expires_on, document_id, created_at, updated_at, certification:certifications ( id, slug, name, description, sort_order, expires ), document:documents ( id, title )",
      )
      .eq("provider_id", profileId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (profileRes.error) {
    throw new Error(
      `getProviderProfileWithCatalog profile: ${profileRes.error.message}`,
    );
  }
  if (servicesRes.error) {
    throw new Error(
      `getProviderProfileWithCatalog services: ${servicesRes.error.message}`,
    );
  }
  if (capabilitiesRes.error) {
    throw new Error(
      `getProviderProfileWithCatalog capabilities: ${capabilitiesRes.error.message}`,
    );
  }
  if (certsRes.error) {
    throw new Error(
      `getProviderProfileWithCatalog certifications: ${certsRes.error.message}`,
    );
  }

  const certs: ProviderCertificationRow[] = (
    (certsRes.data ?? []) as CertificationJoinRow[]
  ).map((row) => {
    const cert = Array.isArray(row.certification)
      ? (row.certification[0] ?? null)
      : row.certification;
    const doc = Array.isArray(row.document)
      ? (row.document[0] ?? null)
      : row.document;
    return {
      id: row.id,
      certification_id: row.certification_id,
      certification: cert,
      reference: row.reference,
      issued_on: row.issued_on,
      expires_on: row.expires_on,
      document_id: row.document_id,
      document_title: doc?.title ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  return {
    profile: (profileRes.data as ProviderProfileRow | null) ?? null,
    serviceCategoryIds: (
      (servicesRes.data ?? []) as { service_category_id: string }[]
    ).map((r) => r.service_category_id),
    capabilityIds: (
      (capabilitiesRes.data ?? []) as { capability_id: string }[]
    ).map((r) => r.capability_id),
    certifications: certs,
  };
}

/**
 * Caller-scoped wrapper: resolves the current user via the server client and
 * forwards to `getProviderProfileWithCatalog`. Symmetric to C3a's
 * `getOwnProviderProfile()` so dashboard / onboarding pages do not have to
 * repeat the auth lookup.
 */
export async function getOwnProviderProfileWithCatalog(): Promise<ProviderCatalogSelection | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  return getProviderProfileWithCatalog(user.id);
}
