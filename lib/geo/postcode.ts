import "server-only";

/**
 * UK postcode geocoding via postcodes.io. Free, unauthenticated, and
 * aligned with UK government open data. Used by the C7a provider search
 * flow to:
 *   1. Geocode a provider's `service_postcode` on profile save (so the
 *      provider is discoverable by radius).
 *   2. Geocode an anonymous searcher's "near me" postcode at request
 *      time (so radius filters work without the caller doing math).
 *
 * This module is deliberately non-"use server" so its sync helper
 * (`isLikelyUkPostcode`) and types are importable from route handlers,
 * Server Components, and Server Actions alike.
 */

export type GeocodedPostcode = {
  lat: number;
  lng: number;
  normalized: string;
};

/**
 * Lightweight UK postcode regex. Not strict - intentionally permissive so
 * we accept historic and unusual formats without hard-coding an allow
 * list. The authoritative check is postcodes.io's 404 response.
 */
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function isLikelyUkPostcode(candidate: string): boolean {
  return UK_POSTCODE_RE.test(candidate.trim());
}

/**
 * Normalizes to uppercase-with-single-space format (e.g. "sw1a1aa" ->
 * "SW1A 1AA"). postcodes.io accepts either form, but we persist the
 * normalized value for display.
 */
function normalize(postcode: string): string {
  const compact = postcode.replace(/\s+/g, "").toUpperCase();
  if (compact.length < 5) return compact;
  return `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
}

/**
 * Returns `{ lat, lng, normalized }` for a valid UK postcode, or `null`
 * if postcodes.io returns 404 / the input is clearly malformed.
 *
 * Fetch is cached at the framework layer: `cache: 'force-cache'` plus a
 * 7-day `revalidate` means lookup results are shared across builds and
 * requests, which is fine - postcode coordinates are stable.
 */
export async function geocodePostcode(
  postcode: string,
): Promise<GeocodedPostcode | null> {
  const trimmed = postcode.trim();
  if (!isLikelyUkPostcode(trimmed)) {
    return null;
  }
  const compact = trimmed.replace(/\s+/g, "").toUpperCase();
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}`;
  // L-2: bound the upstream request with a 2s timeout, and on ANY
  // failure (timeout, network, non-2xx) return null so the caller can
  // treat the near-query as "no radius filter" rather than surfacing a
  // 500. This protects `updateProviderProfile` and
  // `/api/providers/search?near=` from an upstream outage.
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "force-cache",
      next: { revalidate: 60 * 60 * 24 * 7 },
      signal: AbortSignal.timeout(2000),
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "geocode.upstream_failed",
        postcode: compact,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "geocode.upstream_status",
        postcode: compact,
        status: res.status,
      }),
    );
    return null;
  }
  let body: { result?: { latitude?: number; longitude?: number } | null };
  try {
    body = (await res.json()) as {
      result?: { latitude?: number; longitude?: number } | null;
    };
  } catch {
    return null;
  }
  const lat = body.result?.latitude;
  const lng = body.result?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }
  return { lat, lng, normalized: normalize(trimmed) };
}
