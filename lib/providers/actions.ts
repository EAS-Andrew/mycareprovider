"use server";

import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { geocodePostcode, isLikelyUkPostcode } from "@/lib/geo/postcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import { CatalogValidationError } from "./catalog";
import type { ProviderProfileRow } from "./types";

/**
 * C3a provider Server Actions.
 *
 * Mirrors the shape of `lib/auth/actions.ts`: every mutating action goes
 * through the user-scoped Supabase client so RLS is the enforcement
 * boundary, and every mutation writes a W2 audit event via
 * `recordAuditEvent`. `verified_at` is never accepted from form input -
 * the db guard trigger on `provider_profiles` would reject it anyway, but
 * we strip it server-side so a partial form post cannot even smuggle it in.
 */

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

const PHONE_RE = /^[0-9 ()+-]+$/;

function parseRatePence(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Hourly rate must be a non-negative whole number of pence");
  }
  return parsed;
}

function parseServiceRadiusKm(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 200) {
    throw new Error("Service radius must be a whole number between 0 and 200 km");
  }
  return parsed;
}

function parseYearsExperience(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Years of experience must be a non-negative whole number");
  }
  return parsed;
}

function parseDateOfBirth(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  // HTML <input type="date"> posts YYYY-MM-DD; interpret as UTC midnight so
  // the age check is stable regardless of server timezone.
  const dob = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) {
    throw new Error("Date of birth is not a valid date");
  }
  const now = new Date();
  if (dob.getTime() >= now.getTime()) {
    throw new Error("Date of birth must be in the past");
  }
  const eighteenYearsAgo = new Date(
    Date.UTC(
      now.getUTCFullYear() - 18,
      now.getUTCMonth(),
      now.getUTCDate(),
    ),
  );
  if (dob.getTime() > eighteenYearsAgo.getTime()) {
    throw new Error("Providers must be at least 18 years old");
  }
  return value;
}

export async function signUpProvider(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const password = formString(formData, "password");
  const displayName = optionalString(formData, "display_name");

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: "provider",
        display_name: displayName,
      },
    },
  });

  if (error) {
    redirect(
      `/auth/provider-sign-up?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Migration 0009 hardened handle_new_auth_user to ignore
  // raw_user_meta_data.role on public sign-ups (only admin invites honour
  // it). The trigger creates the profile as 'receiver' by default, so we
  // must use the admin client to set the correct role post-signup.
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) {
    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({ role: "provider" })
      .eq("id", authData.user.id);
  }

  // Audit the signup so the W2 log captures intent independent of profile
  // completion. The provider_profiles row is created lazily by
  // updateProviderProfile the first time the caller saves onboarding.
  await recordAuditEvent({
    action: "provider.signup",
    subjectTable: "auth.users",
    subjectId: email,
    after: { email, role: "provider", display_name: displayName },
  });

  redirect("/provider/onboarding?welcome=1");
}

export async function updateProviderProfile(
  formData: FormData,
): Promise<void> {
  // Strip anything the form might have tried to smuggle in. `verified_at` is
  // admin-only (enforced at the db layer by tg_provider_profiles_guard) but
  // we drop it pre-query so it cannot round-trip through the object literal.
  formData.delete("verified_at");
  formData.delete("id");
  formData.delete("deleted_at");
  formData.delete("created_at");
  formData.delete("updated_at");
  // Coordinates are derived from service_postcode server-side; never accept
  // them from the client. Same for the geocode timestamp.
  formData.delete("latitude");
  formData.delete("longitude");
  formData.delete("geocoded_at");

  const headline = optionalString(formData, "headline");
  const bio = optionalString(formData, "bio");
  const dateOfBirth = parseDateOfBirth(optionalString(formData, "date_of_birth"));
  const phoneRaw = optionalString(formData, "phone");
  if (phoneRaw !== null && !PHONE_RE.test(phoneRaw)) {
    throw new Error("Phone must contain only digits, spaces, parentheses, + or -");
  }
  const addressLine1 = optionalString(formData, "address_line1");
  const addressLine2 = optionalString(formData, "address_line2");
  const city = optionalString(formData, "city");
  const postcodeRaw = optionalString(formData, "postcode");
  const postcode = postcodeRaw?.trim() ?? null;
  if (postcodeRaw !== null && postcode === "") {
    throw new Error("Postcode cannot be empty");
  }
  const servicePostcodeRaw = optionalString(formData, "service_postcode");
  const servicePostcode = servicePostcodeRaw?.trim() ?? null;
  const serviceRadiusKm = parseServiceRadiusKm(
    optionalString(formData, "service_radius_km"),
  );
  const country = optionalString(formData, "country") ?? "GB";
  const yearsExperience = parseYearsExperience(
    optionalString(formData, "years_experience"),
  );
  const hourlyRatePence = parseRatePence(
    optionalString(formData, "hourly_rate_pence"),
  );

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?error=sign-in-required");
  }

  // H-2: role is read from `profiles.role` via getCurrentRole. Never trust
  // `user.user_metadata.role` (user-writable) or `app_metadata.app_role`
  // (not populated by the custom access token hook).
  const callerRole = await getCurrentRole(supabase, user);

  if (callerRole !== "provider" && callerRole !== "provider_company") {
    redirect("/auth/sign-in?error=provider-required");
  }

  const profileId = user.id;

  const { data: existing } = await supabase
    .from("provider_profiles")
    .select("id, latitude, longitude, service_postcode, geocoded_at")
    .eq("id", profileId)
    .maybeSingle();

  // C-1: Do NOT fall back to personal `postcode` when `service_postcode`
  // is blank. The anon column grant on `provider_profiles` exposes
  // `service_postcode`/`latitude`/`longitude`, so falling back would
  // silently publish the provider's home address to every unauthenticated
  // search caller. If `service_postcode` is null/empty we null out all
  // geocoding state so the row simply does not appear in radius search.
  const postcodeForGeocoding = servicePostcode;

  // Only re-geocode when the relevant postcode actually changed. This
  // avoids hammering postcodes.io on every profile save and keeps
  // `geocoded_at` stable for unchanged rows.
  const existingLatitude =
    (existing?.latitude as number | null | undefined) ?? null;
  const existingLongitude =
    (existing?.longitude as number | null | undefined) ?? null;
  const existingServicePostcode =
    (existing?.service_postcode as string | null | undefined) ?? null;
  const existingGeocodedAt =
    (existing?.geocoded_at as string | null | undefined) ?? null;

  let latitude: number | null = existingLatitude;
  let longitude: number | null = existingLongitude;
  let geocodedAt: string | null = existingGeocodedAt;

  const postcodeChanged = postcodeForGeocoding !== existingServicePostcode;

  if (postcodeForGeocoding === null) {
    // Cleared postcode - drop the coordinates too.
    latitude = null;
    longitude = null;
    geocodedAt = null;
  } else if (postcodeChanged) {
    if (!isLikelyUkPostcode(postcodeForGeocoding)) {
      throw new CatalogValidationError(
        "geocode_failed",
        "That postcode does not look like a UK postcode. Double-check and try again.",
      );
    }
    const geocoded = await geocodePostcode(postcodeForGeocoding);
    if (geocoded === null) {
      // Keep existing lat/lng; tell the caller why the save was aborted.
      throw new CatalogValidationError(
        "geocode_failed",
        "We could not find that postcode. Check it and try again, or leave it blank to skip location.",
      );
    }
    latitude = geocoded.lat;
    longitude = geocoded.lng;
    geocodedAt = new Date().toISOString();
  }

  const payload = {
    id: profileId,
    headline,
    bio,
    date_of_birth: dateOfBirth,
    phone: phoneRaw,
    address_line1: addressLine1,
    address_line2: addressLine2,
    city,
    postcode,
    country,
    years_experience: yearsExperience,
    hourly_rate_pence: hourlyRatePence,
    service_postcode: postcodeForGeocoding,
    service_radius_km: serviceRadiusKm,
    latitude,
    longitude,
    geocoded_at: geocodedAt,
  };

  if (existing === null) {
    const { error } = await supabase.from("provider_profiles").insert(payload);
    if (error) {
      redirect(
        `/provider/onboarding?error=${encodeURIComponent(error.message)}`,
      );
    }
  } else {
    const { error } = await supabase
      .from("provider_profiles")
      .update(payload)
      .eq("id", profileId);
    if (error) {
      redirect(
        `/provider/onboarding?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  // Redacted `after` payload: no phone, DOB, or address lines in the audit
  // log body. The subject_id still points at the row for correlation.
  await recordAuditEvent({
    action: "provider.profile.update",
    subjectTable: "public.provider_profiles",
    subjectId: profileId,
    after: {
      headline,
      bio,
      city,
      country,
      years_experience: yearsExperience,
      hourly_rate_pence: hourlyRatePence,
    },
  });

  redirect("/provider/onboarding?saved=1");
}

export async function getOwnProviderProfile(): Promise<ProviderProfileRow | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("provider_profiles")
    .select(
      "id, headline, bio, date_of_birth, phone, address_line1, address_line2, city, postcode, country, years_experience, hourly_rate_pence, service_postcode, service_radius_km, latitude, longitude, geocoded_at, verified_at, created_at, updated_at, deleted_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`getOwnProviderProfile: ${error.message}`);
  }

  return (data as ProviderProfileRow | null) ?? null;
}
