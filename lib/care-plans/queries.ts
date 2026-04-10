import "server-only";

import { getCurrentRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";

import type {
  CarePlanActivityRow,
  CarePlanVersionRow,
  CarePlanWithParticipants,
} from "./types";

async function getAuthedClient() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const role = await getCurrentRole(supabase, user);
  return { supabase, user, role };
}

/**
 * List care plans for the current user, scoped by role.
 * Providers see plans they created; receivers see plans for them.
 * Family members see plans for receivers in their care circles.
 * RLS enforces visibility via app.can_see_care_plan().
 */
export async function getMyCarePlans(): Promise<CarePlanWithParticipants[]> {
  const ctx = await getAuthedClient();
  if (!ctx) return [];

  const { data, error } = await ctx.supabase
    .from("care_plans")
    .select(
      "id, provider_id, receiver_id, title, status, created_at, updated_at, deleted_at",
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`getMyCarePlans: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  // Fetch display names for providers and receivers
  const providerIds = [
    ...new Set((data as CarePlanWithParticipants[]).map((p) => p.provider_id)),
  ];
  const receiverIds = [
    ...new Set((data as CarePlanWithParticipants[]).map((p) => p.receiver_id)),
  ];
  const allIds = [...new Set([...providerIds, ...receiverIds])];

  const { data: profiles } = await ctx.supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", allIds);

  const nameMap = new Map<string, string>();
  for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
    nameMap.set(p.id, p.display_name ?? "Unknown");
  }

  return (data as CarePlanWithParticipants[]).map((plan) => ({
    ...plan,
    provider_name: nameMap.get(plan.provider_id) ?? null,
    receiver_name: nameMap.get(plan.receiver_id) ?? null,
  }));
}

/**
 * Get a single care plan with its latest version.
 */
export async function getCarePlan(carePlanId: string): Promise<{
  plan: CarePlanWithParticipants;
  latestVersion: CarePlanVersionRow | null;
} | null> {
  const ctx = await getAuthedClient();
  if (!ctx) return null;

  const { data: plan, error } = await ctx.supabase
    .from("care_plans")
    .select(
      "id, provider_id, receiver_id, title, status, created_at, updated_at, deleted_at",
    )
    .eq("id", carePlanId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getCarePlan: ${error.message}`);
  if (!plan) return null;

  // Fetch participant names
  const { data: profiles } = await ctx.supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", [
      (plan as CarePlanWithParticipants).provider_id,
      (plan as CarePlanWithParticipants).receiver_id,
    ]);

  const nameMap = new Map<string, string>();
  for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
    nameMap.set(p.id, p.display_name ?? "Unknown");
  }

  const planWithNames: CarePlanWithParticipants = {
    ...(plan as CarePlanWithParticipants),
    provider_name:
      nameMap.get((plan as CarePlanWithParticipants).provider_id) ?? null,
    receiver_name:
      nameMap.get((plan as CarePlanWithParticipants).receiver_id) ?? null,
  };

  // Get latest version
  const { data: version } = await ctx.supabase
    .from("care_plan_versions")
    .select("*")
    .eq("care_plan_id", carePlanId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    plan: planWithNames,
    latestVersion: (version as CarePlanVersionRow) ?? null,
  };
}

/**
 * Get all versions for a care plan.
 */
export async function getCarePlanVersions(
  carePlanId: string,
): Promise<CarePlanVersionRow[]> {
  const ctx = await getAuthedClient();
  if (!ctx) return [];

  const { data, error } = await ctx.supabase
    .from("care_plan_versions")
    .select("*")
    .eq("care_plan_id", carePlanId)
    .order("version_number", { ascending: false });

  if (error) throw new Error(`getCarePlanVersions: ${error.message}`);
  return (data ?? []) as CarePlanVersionRow[];
}

/**
 * Get a specific version with its activities.
 */
export async function getCarePlanVersion(versionId: string): Promise<{
  version: CarePlanVersionRow;
  activities: CarePlanActivityRow[];
} | null> {
  const ctx = await getAuthedClient();
  if (!ctx) return null;

  const { data: version, error } = await ctx.supabase
    .from("care_plan_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();

  if (error) throw new Error(`getCarePlanVersion: ${error.message}`);
  if (!version) return null;

  const { data: activities } = await ctx.supabase
    .from("care_plan_activities")
    .select("*")
    .eq("care_plan_version_id", versionId)
    .order("sort_order", { ascending: true });

  return {
    version: version as CarePlanVersionRow,
    activities: (activities ?? []) as CarePlanActivityRow[],
  };
}

/**
 * Get the active care plan for a provider-receiver pair (if any).
 */
export async function getActiveCarePlan(
  providerId: string,
  receiverId: string,
): Promise<CarePlanWithParticipants | null> {
  const ctx = await getAuthedClient();
  if (!ctx) return null;

  const { data, error } = await ctx.supabase
    .from("care_plans")
    .select(
      "id, provider_id, receiver_id, title, status, created_at, updated_at, deleted_at",
    )
    .eq("provider_id", providerId)
    .eq("receiver_id", receiverId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getActiveCarePlan: ${error.message}`);
  if (!data) return null;

  return {
    ...(data as CarePlanWithParticipants),
    provider_name: null,
    receiver_name: null,
  };
}
