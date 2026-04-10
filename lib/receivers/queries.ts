"use server";

import { createServerClient } from "@/lib/supabase/server";

import type { ReceiverProfileRow } from "./types";

/**
 * C6b receiver profile read helpers. Queries go through the user-scoped
 * client so RLS enforces self-read and care-circle-member visibility.
 */

export async function getReceiverProfile(): Promise<ReceiverProfileRow | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("receiver_profiles")
    .select(
      "id, care_needs_summary, preferred_gender, preferred_schedule, mobility_level, communication_needs, dietary_requirements, medical_conditions_summary, postcode, latitude, longitude, geocoded_at, created_at, updated_at, deleted_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`getReceiverProfile: ${error.message}`);
  }

  return (data as ReceiverProfileRow | null) ?? null;
}

/**
 * Fetch a receiver profile as a care circle member. The user-scoped client
 * enforces the circle_read RLS policy - if the caller is not in the
 * receiver's circle, Supabase returns null.
 */
export async function getReceiverProfileForCircle(
  receiverId: string,
): Promise<ReceiverProfileRow | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("receiver_profiles")
    .select(
      "id, care_needs_summary, preferred_gender, preferred_schedule, mobility_level, communication_needs, dietary_requirements, medical_conditions_summary, postcode, latitude, longitude, geocoded_at, created_at, updated_at, deleted_at",
    )
    .eq("id", receiverId)
    .maybeSingle();

  if (error) {
    throw new Error(`getReceiverProfileForCircle: ${error.message}`);
  }

  return (data as ReceiverProfileRow | null) ?? null;
}
