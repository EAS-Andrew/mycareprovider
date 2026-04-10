"use server";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";

/**
 * C6b company catalog Server Actions (services, capabilities).
 * Mirrors the delete-and-reinsert pattern from lib/providers/profile-actions.ts.
 */

type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>;

async function requireCompany(): Promise<{
  supabase: ServerSupabase;
  userId: string;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("You must sign in to continue");
  }
  const role = await getCurrentRole(supabase, user);
  if (role !== "provider_company") {
    throw new Error("This page is for company accounts only");
  }
  return { supabase, userId: user.id };
}

function normaliseIdList(input: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    seen.add(trimmed);
  }
  return Array.from(seen);
}

function diffIdSets(
  existing: string[],
  desired: string[],
): { toInsert: string[]; toDelete: string[] } {
  const existingSet = new Set(existing);
  const desiredSet = new Set(desired);
  return {
    toInsert: [...desiredSet].filter((id) => !existingSet.has(id)),
    toDelete: [...existingSet].filter((id) => !desiredSet.has(id)),
  };
}

export async function setCompanyServices(
  serviceCategoryIds: string[],
): Promise<void> {
  const desired = normaliseIdList(serviceCategoryIds);
  const { supabase, userId } = await requireCompany();

  const { data: existingRows, error: fetchErr } = await supabase
    .from("company_services")
    .select("service_category_id")
    .eq("company_id", userId);
  if (fetchErr) {
    throw new Error(`setCompanyServices fetch: ${fetchErr.message}`);
  }

  const existing = (
    (existingRows ?? []) as { service_category_id: string }[]
  ).map((r) => r.service_category_id);
  const { toInsert, toDelete } = diffIdSets(existing, desired);

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("company_services")
      .delete()
      .eq("company_id", userId)
      .in("service_category_id", toDelete);
    if (error) {
      throw new Error(`setCompanyServices delete: ${error.message}`);
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("company_services").insert(
      toInsert.map((service_category_id) => ({
        company_id: userId,
        service_category_id,
      })),
    );
    if (error) {
      throw new Error(`Could not save services: ${error.message}`);
    }
  }

  await recordAuditEvent({
    action: "company.services.set",
    subjectTable: "public.company_services",
    subjectId: userId,
    before: { ids: existing },
    after: { ids: desired, added: toInsert, removed: toDelete },
  });
}

export async function setCompanyCapabilities(
  capabilityIds: string[],
): Promise<void> {
  const desired = normaliseIdList(capabilityIds);
  const { supabase, userId } = await requireCompany();

  const { data: existingRows, error: fetchErr } = await supabase
    .from("company_capabilities")
    .select("capability_id")
    .eq("company_id", userId);
  if (fetchErr) {
    throw new Error(`setCompanyCapabilities fetch: ${fetchErr.message}`);
  }

  const existing = (
    (existingRows ?? []) as { capability_id: string }[]
  ).map((r) => r.capability_id);
  const { toInsert, toDelete } = diffIdSets(existing, desired);

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("company_capabilities")
      .delete()
      .eq("company_id", userId)
      .in("capability_id", toDelete);
    if (error) {
      throw new Error(`setCompanyCapabilities delete: ${error.message}`);
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("company_capabilities").insert(
      toInsert.map((capability_id) => ({
        company_id: userId,
        capability_id,
      })),
    );
    if (error) {
      throw new Error(`Could not save capabilities: ${error.message}`);
    }
  }

  await recordAuditEvent({
    action: "company.capabilities.set",
    subjectTable: "public.company_capabilities",
    subjectId: userId,
    before: { ids: existing },
    after: { ids: desired, added: toInsert, removed: toDelete },
  });
}

export type CompanyCatalogSelection = {
  serviceCategoryIds: string[];
  capabilityIds: string[];
};

export async function getCompanyProfileWithCatalog(): Promise<CompanyCatalogSelection | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const [servicesRes, capabilitiesRes] = await Promise.all([
    supabase
      .from("company_services")
      .select("service_category_id")
      .eq("company_id", user.id),
    supabase
      .from("company_capabilities")
      .select("capability_id")
      .eq("company_id", user.id),
  ]);

  if (servicesRes.error) {
    throw new Error(
      `getCompanyProfileWithCatalog services: ${servicesRes.error.message}`,
    );
  }
  if (capabilitiesRes.error) {
    throw new Error(
      `getCompanyProfileWithCatalog capabilities: ${capabilitiesRes.error.message}`,
    );
  }

  return {
    serviceCategoryIds: (
      (servicesRes.data ?? []) as { service_category_id: string }[]
    ).map((r) => r.service_category_id),
    capabilityIds: (
      (capabilitiesRes.data ?? []) as { capability_id: string }[]
    ).map((r) => r.capability_id),
  };
}
