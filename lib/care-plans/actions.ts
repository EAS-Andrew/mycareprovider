"use server";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import type { LineItem, CarePlanActivityRow } from "./types";

type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>;

class CarePlanError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CarePlanError";
  }
}

async function requireAuth(): Promise<{
  supabase: ServerSupabase;
  userId: string;
  role: string;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new CarePlanError("sign-in-required", "You must sign in to continue");
  }
  const role = await getCurrentRole(supabase, user);
  if (!role) {
    throw new CarePlanError("no-role", "Could not determine your role");
  }
  return { supabase, userId: user.id, role };
}

async function requireProvider(): Promise<{
  supabase: ServerSupabase;
  userId: string;
}> {
  const { supabase, userId, role } = await requireAuth();
  if (role !== "provider" && role !== "provider_company") {
    throw new CarePlanError(
      "provider-required",
      "This action is for care providers only",
    );
  }
  return { supabase, userId };
}

/**
 * Story 26: Provider creates a new draft care plan.
 */
export async function createCarePlan(
  title: string,
  receiverId: string,
): Promise<string> {
  const trimmedTitle = title?.trim() ?? "";
  if (trimmedTitle.length === 0) {
    throw new CarePlanError("title-required", "Care plan title is required");
  }
  const trimmedReceiverId = receiverId?.trim() ?? "";
  if (trimmedReceiverId.length === 0) {
    throw new CarePlanError(
      "receiver-required",
      "A care receiver must be selected",
    );
  }

  const { supabase, userId } = await requireProvider();

  const { data, error } = await supabase
    .from("care_plans")
    .insert({
      provider_id: userId,
      receiver_id: trimmedReceiverId,
      title: trimmedTitle,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`createCarePlan: ${error.message}`);
  }

  const planId = (data as { id: string }).id;

  await recordAuditEvent({
    action: "care_plan.create",
    subjectTable: "public.care_plans",
    subjectId: planId,
    after: { title: trimmedTitle, receiver_id: trimmedReceiverId },
  });

  return planId;
}

/**
 * Story 26/29: Provider creates a new version with activities and line items.
 */
export async function createCarePlanVersion(params: {
  carePlanId: string;
  activities: Omit<CarePlanActivityRow, "id" | "care_plan_version_id" | "created_at">[];
  lineItems: LineItem[];
  notes?: string;
}): Promise<string> {
  const { carePlanId, activities, lineItems, notes } = params;
  const { supabase, userId } = await requireProvider();

  // Get current max version number
  const { data: existing } = await supabase
    .from("care_plan_versions")
    .select("version_number")
    .eq("care_plan_id", carePlanId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion =
    ((existing as { version_number: number } | null)?.version_number ?? 0) + 1;

  // Build snapshot
  const snapshot = {
    activities: activities.map((a, i) => ({
      ...a,
      sort_order: a.sort_order ?? i,
    })),
    line_items: lineItems,
    notes: notes ?? null,
  };

  const { data: version, error } = await supabase
    .from("care_plan_versions")
    .insert({
      care_plan_id: carePlanId,
      version_number: nextVersion,
      snapshot,
      line_items: lineItems,
      created_by: userId,
      status: "draft",
      notes: notes?.trim() || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`createCarePlanVersion: ${error.message}`);

  const versionId = (version as { id: string }).id;

  // Insert activities
  if (activities.length > 0) {
    const activityRows = activities.map((a, i) => ({
      care_plan_version_id: versionId,
      title: a.title,
      description: a.description || null,
      frequency: a.frequency,
      duration_minutes: a.duration_minutes || null,
      sort_order: a.sort_order ?? i,
    }));

    const { error: actError } = await supabase
      .from("care_plan_activities")
      .insert(activityRows);

    if (actError)
      throw new Error(`createCarePlanVersion activities: ${actError.message}`);
  }

  await recordAuditEvent({
    action: "care_plan.version.create",
    subjectTable: "public.care_plan_versions",
    subjectId: versionId,
    after: {
      care_plan_id: carePlanId,
      version_number: nextVersion,
      activity_count: activities.length,
      line_item_count: lineItems.length,
    },
  });

  return versionId;
}

/**
 * Story 27: Provider submits version for approval.
 * Updates version status to 'submitted' and plan status to 'pending_approval'.
 */
export async function submitForApproval(versionId: string): Promise<void> {
  const { supabase } = await requireProvider();
  const admin = createAdminClient();

  // Read the version to get the care_plan_id
  const { data: version, error: fetchErr } = await supabase
    .from("care_plan_versions")
    .select("id, care_plan_id, status")
    .eq("id", versionId)
    .maybeSingle();

  if (fetchErr) throw new Error(`submitForApproval: ${fetchErr.message}`);
  if (!version) {
    throw new CarePlanError("not-found", "Version not found");
  }
  if ((version as { status: string }).status !== "draft") {
    throw new CarePlanError(
      "invalid-status",
      "Only draft versions can be submitted for approval",
    );
  }

  const carePlanId = (version as { care_plan_id: string }).care_plan_id;

  // Use admin client for the version status update (append-only, no UPDATE policy for users)
  const { error: versionErr } = await admin
    .from("care_plan_versions")
    .update({ status: "submitted" })
    .eq("id", versionId);

  if (versionErr)
    throw new Error(`submitForApproval version update: ${versionErr.message}`);

  // Update care plan status (user has UPDATE RLS via participant policy)
  const { error: planErr } = await supabase
    .from("care_plans")
    .update({ status: "pending_approval" })
    .eq("id", carePlanId);

  if (planErr)
    throw new Error(`submitForApproval plan update: ${planErr.message}`);

  await recordAuditEvent({
    action: "care_plan.version.submit",
    subjectTable: "public.care_plan_versions",
    subjectId: versionId,
    after: { care_plan_id: carePlanId },
  });
}

/**
 * Story 27/78: Receiver or family member approves a care plan version.
 * Records visit media consent decision.
 */
export async function approveCarePlan(
  versionId: string,
  visitMediaConsent: boolean,
): Promise<void> {
  const { supabase, userId, role } = await requireAuth();

  if (role !== "receiver" && role !== "family_member") {
    throw new CarePlanError(
      "not-authorized",
      "Only receivers or family members can approve care plans",
    );
  }

  // Verify the version exists and is submitted
  const { data: version, error: fetchErr } = await supabase
    .from("care_plan_versions")
    .select("id, care_plan_id, status")
    .eq("id", versionId)
    .maybeSingle();

  if (fetchErr) throw new Error(`approveCarePlan: ${fetchErr.message}`);
  if (!version) {
    throw new CarePlanError("not-found", "Version not found");
  }
  if ((version as { status: string }).status !== "submitted") {
    throw new CarePlanError(
      "invalid-status",
      "Only submitted versions can be approved",
    );
  }

  const carePlanId = (version as { care_plan_id: string }).care_plan_id;
  const admin = createAdminClient();

  // Update version via admin client (append-only table, no user UPDATE policy)
  const { error: versionErr } = await admin
    .from("care_plan_versions")
    .update({
      status: "approved",
      approved_by: userId,
      approved_at: new Date().toISOString(),
      visit_media_consent: visitMediaConsent,
      consent_granted_by: userId,
      consent_granted_at: new Date().toISOString(),
    })
    .eq("id", versionId);

  if (versionErr)
    throw new Error(`approveCarePlan version update: ${versionErr.message}`);

  // Update care plan status to active
  const { error: planErr } = await supabase
    .from("care_plans")
    .update({ status: "active" })
    .eq("id", carePlanId);

  if (planErr)
    throw new Error(`approveCarePlan plan update: ${planErr.message}`);

  await recordAuditEvent({
    action: "care_plan.version.approve",
    subjectTable: "public.care_plan_versions",
    subjectId: versionId,
    after: {
      care_plan_id: carePlanId,
      visit_media_consent: visitMediaConsent,
      approved_by: userId,
    },
  });
}

/**
 * Story 27: Receiver or family member rejects a care plan version.
 */
export async function rejectCarePlan(
  versionId: string,
  reason: string,
): Promise<void> {
  const { supabase, userId, role } = await requireAuth();

  if (role !== "receiver" && role !== "family_member") {
    throw new CarePlanError(
      "not-authorized",
      "Only receivers or family members can reject care plans",
    );
  }

  const trimmedReason = reason?.trim() ?? "";
  if (trimmedReason.length === 0) {
    throw new CarePlanError(
      "reason-required",
      "A reason for rejection is required",
    );
  }

  const { data: version, error: fetchErr } = await supabase
    .from("care_plan_versions")
    .select("id, care_plan_id, status")
    .eq("id", versionId)
    .maybeSingle();

  if (fetchErr) throw new Error(`rejectCarePlan: ${fetchErr.message}`);
  if (!version) {
    throw new CarePlanError("not-found", "Version not found");
  }
  if ((version as { status: string }).status !== "submitted") {
    throw new CarePlanError(
      "invalid-status",
      "Only submitted versions can be rejected",
    );
  }

  const carePlanId = (version as { care_plan_id: string }).care_plan_id;
  const admin = createAdminClient();

  // Update version via admin client
  const { error: versionErr } = await admin
    .from("care_plan_versions")
    .update({
      status: "rejected",
      rejection_reason: trimmedReason,
    })
    .eq("id", versionId);

  if (versionErr)
    throw new Error(`rejectCarePlan version update: ${versionErr.message}`);

  // Transition plan back to draft so provider can revise
  const { error: planErr } = await supabase
    .from("care_plans")
    .update({ status: "draft" })
    .eq("id", carePlanId);

  if (planErr)
    throw new Error(`rejectCarePlan plan update: ${planErr.message}`);

  await recordAuditEvent({
    action: "care_plan.version.reject",
    subjectTable: "public.care_plan_versions",
    subjectId: versionId,
    after: {
      care_plan_id: carePlanId,
      rejected_by: userId,
      reason: trimmedReason,
    },
  });
}

/**
 * Pause an active care plan. Only providers may pause.
 */
export async function pauseCarePlan(carePlanId: string): Promise<void> {
  const { supabase } = await requireProvider();

  const { error } = await supabase
    .from("care_plans")
    .update({ status: "paused" })
    .eq("id", carePlanId)
    .eq("status", "active");

  if (error) throw new Error(`pauseCarePlan: ${error.message}`);

  await recordAuditEvent({
    action: "care_plan.pause",
    subjectTable: "public.care_plans",
    subjectId: carePlanId,
  });
}

/**
 * Resume a paused care plan. Only providers may resume.
 */
export async function resumeCarePlan(carePlanId: string): Promise<void> {
  const { supabase } = await requireProvider();

  const { error } = await supabase
    .from("care_plans")
    .update({ status: "active" })
    .eq("id", carePlanId)
    .eq("status", "paused");

  if (error) throw new Error(`resumeCarePlan: ${error.message}`);

  await recordAuditEvent({
    action: "care_plan.resume",
    subjectTable: "public.care_plans",
    subjectId: carePlanId,
  });
}

/**
 * Complete an active care plan. Only providers may complete.
 */
export async function completeCarePlan(carePlanId: string): Promise<void> {
  const { supabase } = await requireProvider();

  const { error } = await supabase
    .from("care_plans")
    .update({ status: "completed" })
    .eq("id", carePlanId)
    .eq("status", "active");

  if (error) throw new Error(`completeCarePlan: ${error.message}`);

  await recordAuditEvent({
    action: "care_plan.complete",
    subjectTable: "public.care_plans",
    subjectId: carePlanId,
  });
}

/**
 * Cancel a care plan (from any status). Providers or receivers may cancel,
 * but not family members.
 */
export async function cancelCarePlan(carePlanId: string): Promise<void> {
  const { supabase, role } = await requireAuth();
  if (role !== "provider" && role !== "provider_company" && role !== "receiver") {
    throw new CarePlanError(
      "not-authorized",
      "Only providers or receivers can cancel care plans",
    );
  }

  const { error } = await supabase
    .from("care_plans")
    .update({ status: "cancelled" })
    .eq("id", carePlanId);

  if (error) throw new Error(`cancelCarePlan: ${error.message}`);

  await recordAuditEvent({
    action: "care_plan.cancel",
    subjectTable: "public.care_plans",
    subjectId: carePlanId,
  });
}
