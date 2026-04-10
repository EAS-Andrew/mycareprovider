"use server";

import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { geocodePostcode, isLikelyUkPostcode } from "@/lib/geo/postcode";
import { createServerClient } from "@/lib/supabase/server";

import type { MobilityLevel } from "./types";

/**
 * C6b receiver profile mutation Server Actions. Mirrors the company/provider
 * action pattern: user-scoped client, role gate, audit event on every mutation.
 */

const VALID_MOBILITY: ReadonlySet<string> = new Set<MobilityLevel>([
  "fully_mobile",
  "limited_mobility",
  "wheelchair_user",
  "bed_bound",
]);

function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

export async function upsertReceiverProfile(
  formData: FormData,
): Promise<void> {
  // Strip fields that must never come from user input.
  formData.delete("id");
  formData.delete("deleted_at");
  formData.delete("created_at");
  formData.delete("updated_at");
  formData.delete("latitude");
  formData.delete("longitude");
  formData.delete("geocoded_at");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?error=sign-in-required");
  }

  const role = await getCurrentRole(supabase, user);
  if (role !== "receiver") {
    redirect("/auth/sign-in?error=receiver-required");
  }

  const profileId = user.id;

  const careNeedsSummary = optionalString(formData, "care_needs_summary");
  const preferredGender = optionalString(formData, "preferred_gender");
  const preferredSchedule = optionalString(formData, "preferred_schedule");
  const mobilityRaw = optionalString(formData, "mobility_level");
  const mobilityLevel =
    mobilityRaw && VALID_MOBILITY.has(mobilityRaw)
      ? (mobilityRaw as MobilityLevel)
      : null;
  const communicationNeeds = optionalString(formData, "communication_needs");
  const dietaryRequirements = optionalString(formData, "dietary_requirements");
  const medicalConditionsSummary = optionalString(
    formData,
    "medical_conditions_summary",
  );
  const postcodeRaw = optionalString(formData, "postcode");

  // Geocode postcode
  const { data: existing } = await supabase
    .from("receiver_profiles")
    .select("id, postcode, latitude, longitude, geocoded_at")
    .eq("id", profileId)
    .maybeSingle();

  let latitude: number | null =
    (existing?.latitude as number | null | undefined) ?? null;
  let longitude: number | null =
    (existing?.longitude as number | null | undefined) ?? null;
  let geocodedAt: string | null =
    (existing?.geocoded_at as string | null | undefined) ?? null;

  const existingPostcode =
    (existing?.postcode as string | null | undefined) ?? null;
  const postcodeChanged = postcodeRaw !== existingPostcode;

  if (postcodeRaw === null) {
    latitude = null;
    longitude = null;
    geocodedAt = null;
  } else if (postcodeChanged) {
    if (!isLikelyUkPostcode(postcodeRaw)) {
      redirect(
        "/receiver/profile?error=" +
          encodeURIComponent(
            "That postcode does not look like a UK postcode. Double-check and try again.",
          ),
      );
    }
    const geocoded = await geocodePostcode(postcodeRaw);
    if (geocoded === null) {
      redirect(
        "/receiver/profile?error=" +
          encodeURIComponent(
            "We could not find that postcode. Check it and try again, or leave it blank.",
          ),
      );
    }
    latitude = geocoded.lat;
    longitude = geocoded.lng;
    geocodedAt = new Date().toISOString();
  }

  const payload = {
    id: profileId,
    care_needs_summary: careNeedsSummary,
    preferred_gender: preferredGender,
    preferred_schedule: preferredSchedule,
    mobility_level: mobilityLevel,
    communication_needs: communicationNeeds,
    dietary_requirements: dietaryRequirements,
    medical_conditions_summary: medicalConditionsSummary,
    postcode: postcodeRaw,
    latitude,
    longitude,
    geocoded_at: geocodedAt,
  };

  if (existing === null) {
    const { error } = await supabase
      .from("receiver_profiles")
      .insert(payload);
    if (error) {
      redirect(
        `/receiver/profile?error=${encodeURIComponent(error.message)}`,
      );
    }
  } else {
    const { error } = await supabase
      .from("receiver_profiles")
      .update(payload)
      .eq("id", profileId);
    if (error) {
      redirect(
        `/receiver/profile?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  await recordAuditEvent({
    action: "receiver.profile.upsert",
    subjectTable: "public.receiver_profiles",
    subjectId: profileId,
    after: {
      care_needs_summary: careNeedsSummary,
      preferred_gender: preferredGender,
      mobility_level: mobilityLevel,
      postcode: postcodeRaw,
    },
  });

  redirect("/receiver/profile?saved=1");
}
