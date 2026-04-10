import "server-only";

import { createServerClient } from "@/lib/supabase/server";
import { geocodePostcode, isLikelyUkPostcode } from "@/lib/geo/postcode";

/**
 * C7a public provider search. Single entry point for:
 *   - the public directory Server Component page (`/providers`)
 *   - the JSON route handler at `/api/providers/search`
 *
 * Calls the `app.search_providers` RPC (migration 0006) through the
 * user-scoped Supabase client so RLS on `provider_profiles` and the
 * linking tables is the authoritative boundary. The RPC itself is
 * `stable security invoker` with `execute` granted to anon, so an
 * unauthenticated browse lands at the same enforcement.
 *
 * No admin client. Anonymous callers see verified, non-soft-deleted
 * rows only; the RPC's `where verified_at is not null` plus the
 * `provider_profiles_public_read` RLS policy cover that end-to-end.
 */

export type ProviderSearchFilters = {
  query?: string;
  near?: { lat: number; lng: number; radiusKm: number };
  serviceSlug?: string;
  capabilitySlug?: string;
  serviceSlugs?: string[];
  capabilitySlugs?: string[];
  certificationSlugs?: string[];
  gender?: string;
  rateMinPence?: number;
  rateMaxPence?: number;
  limit?: number;
  offset?: number;
};

export type ProviderSearchResult = {
  id: string;
  headline: string | null;
  bio: string | null;
  city: string | null;
  country: string | null;
  hourlyRatePence: number | null;
  yearsExperience: number | null;
  gender: string | null;
  distanceKm: number | null;
  verifiedAt: string;
};

type RpcRow = {
  id: string;
  headline: string | null;
  bio: string | null;
  city: string | null;
  country: string | null;
  hourly_rate_pence: number | null;
  years_experience: number | null;
  gender: string | null;
  distance_km: number | null;
  verified_at: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_RADIUS_KM = 25;
const MAX_RADIUS_KM = 200;
const MIN_RADIUS_KM = 1;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  if (limit < 1) return 1;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(limit);
}

function clampOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

function clampRadiusKm(raw: string | number | undefined): number {
  const asNum = typeof raw === "string" ? Number(raw) : raw;
  if (typeof asNum !== "number" || !Number.isFinite(asNum)) {
    return DEFAULT_RADIUS_KM;
  }
  if (asNum < MIN_RADIUS_KM) return MIN_RADIUS_KM;
  if (asNum > MAX_RADIUS_KM) return MAX_RADIUS_KM;
  return Math.floor(asNum);
}

/**
 * Executes the search. The caller is responsible for geocoding any
 * "near me" postcode into lat/lng up front (see `resolveSearchLocation`).
 */
export async function searchProviders(
  filters: ProviderSearchFilters,
): Promise<ProviderSearchResult[]> {
  const supabase = await createServerClient();

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  // H-3: server-side clamp on radius, mirroring the SQL cap sql-fixer
  // lands in migration 0009. PostgREST exposes `public.search_providers`
  // to anon, so a direct RPC call could bypass every TS layer above
  // this function. Clamping here guarantees the DB still gets a
  // already-clamped value when this helper is the caller, while the
  // SQL cap remains the authoritative line of defence.
  const radiusKm =
    filters.near?.radiusKm !== undefined
      ? clampRadiusKm(filters.near.radiusKm)
      : null;

  // Build service/capability slug arrays. Support both legacy single-slug
  // params and new array params for backwards compatibility during the
  // transition. The RPC signature (migration 0010) accepts arrays only.
  const serviceSlugs: string[] = [
    ...(filters.serviceSlugs ?? []),
    ...(filters.serviceSlug ? [filters.serviceSlug] : []),
  ];
  const capabilitySlugs: string[] = [
    ...(filters.capabilitySlugs ?? []),
    ...(filters.capabilitySlug ? [filters.capabilitySlug] : []),
  ];

  const { data, error } = await supabase.rpc("search_providers", {
    query: filters.query && filters.query.trim().length > 0 ? filters.query.trim() : null,
    near_lat: filters.near?.lat ?? null,
    near_lng: filters.near?.lng ?? null,
    radius_km: radiusKm,
    filter_services: serviceSlugs.length > 0 ? serviceSlugs : null,
    filter_capabilities: capabilitySlugs.length > 0 ? capabilitySlugs : null,
    filter_certifications: filters.certificationSlugs?.length ? filters.certificationSlugs : null,
    filter_gender: filters.gender ?? null,
    filter_rate_min: filters.rateMinPence ?? null,
    filter_rate_max: filters.rateMaxPence ?? null,
    limit_count: limit,
    offset_count: offset,
  });

  if (error) {
    throw new Error(`searchProviders: ${error.message}`);
  }

  return ((data ?? []) as RpcRow[]).map((row) => ({
    id: row.id,
    headline: row.headline,
    bio: row.bio,
    city: row.city,
    country: row.country,
    hourlyRatePence: row.hourly_rate_pence,
    yearsExperience: row.years_experience,
    gender: row.gender,
    distanceKm: row.distance_km,
    verifiedAt: row.verified_at,
  }));
}

/**
 * Resolves a raw `?near=` query string (a UK postcode) plus an optional
 * `?radius=` into the lat/lng/radius shape the RPC expects. Returns
 * `undefined` when the postcode is absent, malformed, or cannot be
 * geocoded - the caller should treat that as "no radius filter".
 */
export async function resolveSearchLocation(
  rawNear: string | undefined,
  rawRadius: string | undefined,
): Promise<ProviderSearchFilters["near"] | undefined> {
  if (!rawNear || rawNear.trim().length === 0) {
    return undefined;
  }
  if (!isLikelyUkPostcode(rawNear)) {
    return undefined;
  }
  const geocoded = await geocodePostcode(rawNear);
  if (!geocoded) {
    return undefined;
  }
  return {
    lat: geocoded.lat,
    lng: geocoded.lng,
    radiusKm: clampRadiusKm(rawRadius),
  };
}
