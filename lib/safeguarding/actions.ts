"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import type {
  SafeguardingSeverity,
  SafeguardingSubjectType,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRIAGE_SLA_SEVERITIES = new Set<SafeguardingSeverity>([
  "medium",
  "high",
  "immediate_risk",
]);

async function requireAdmin(): Promise<string> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("sign-in-required");

  const role = await getCurrentRole(supabase, user);
  if (role !== "admin") throw new Error("admin-required");

  return user.id;
}

// ---------------------------------------------------------------------------
// Submit a safeguarding report (authenticated OR anonymous)
// ---------------------------------------------------------------------------

export async function submitSafeguardingReport(
  formData: FormData,
): Promise<void> {
  const subjectType = formData.get("subjectType") as SafeguardingSubjectType;
  const severity = (formData.get("severity") as SafeguardingSeverity) || "medium";
  const summary = (formData.get("summary") as string)?.trim();
  const details = (formData.get("details") as string)?.trim() || null;
  const subjectDescription =
    (formData.get("subjectDescription") as string)?.trim() || null;

  if (!subjectType || !summary) {
    redirect("/safeguarding?error=Subject+type+and+summary+are+required");
  }

  // Determine if this is an authenticated or anonymous submission
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const reporterRole = user ? await getCurrentRole(supabase, user) : null;

  const triageDeadline = TRIAGE_SLA_SEVERITIES.has(severity)
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Use admin client for the insert so both anon and authenticated can write.
  // RLS INSERT policies allow it, but using admin client avoids edge cases
  // with anon key grants on related FK lookups.
  const admin = createAdminClient();

  const { data: inserted, error } = await admin
    .from("safeguarding_reports")
    .insert({
      reporter_id: user?.id ?? null,
      reporter_role: reporterRole,
      subject_type: subjectType,
      subject_description: subjectDescription,
      severity,
      summary,
      details,
      status: "submitted",
      triage_deadline: triageDeadline,
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/safeguarding?error=${encodeURIComponent(error.message)}`);
  }

  // Audit with redacted payload (no PII in audit log for safeguarding)
  if (user) {
    await recordAuditEvent({
      action: "safeguarding_report_submitted",
      subjectTable: "safeguarding_reports",
      subjectId: inserted.id,
      after: { severity, status: "submitted" },
    });
  } else {
    await recordAuditEvent({
      action: "safeguarding_report_submitted",
      subjectTable: "safeguarding_reports",
      subjectId: inserted.id,
      after: { severity, status: "submitted", anonymous: true },
      system: true,
    });
  }

  // Redirect based on context
  if (user) {
    const role = reporterRole;
    if (role === "receiver" || role === "family_member") {
      redirect("/receiver/safeguarding?ok=Report+submitted");
    }
    if (role === "provider" || role === "provider_company") {
      redirect("/provider/safeguarding?ok=Report+submitted");
    }
    if (role === "admin") {
      redirect("/admin/safeguarding?ok=Report+submitted");
    }
  }

  redirect("/safeguarding?ok=Report+submitted");
}

// ---------------------------------------------------------------------------
// Triage: admin sets severity, assigns reviewer
// ---------------------------------------------------------------------------

export async function triageReport(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const reportId = formData.get("reportId") as string;
  const severity = formData.get("severity") as SafeguardingSeverity;
  const assignedTo = (formData.get("assignedTo") as string) || null;

  if (!reportId || !severity) {
    redirect(
      `/admin/safeguarding?error=${encodeURIComponent("Invalid triage request")}`,
    );
  }

  const admin = createAdminClient();

  const { data: before } = await admin
    .from("safeguarding_reports")
    .select("status, severity, assigned_to")
    .eq("id", reportId)
    .single();

  const triageDeadline = TRIAGE_SLA_SEVERITIES.has(severity)
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { error } = await admin
    .from("safeguarding_reports")
    .update({
      status: "triaged",
      severity,
      assigned_to: assignedTo,
      triage_deadline: triageDeadline,
    })
    .eq("id", reportId);

  if (error) {
    redirect(
      `/admin/safeguarding/${reportId}?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Add triage event
  await admin.from("safeguarding_report_events").insert({
    report_id: reportId,
    actor_id: adminId,
    event_type: "triage",
    details: {
      previous_severity: before?.severity,
      new_severity: severity,
      assigned_to: assignedTo,
    },
  });

  await recordAuditEvent({
    action: "safeguarding_report_triaged",
    subjectTable: "safeguarding_reports",
    subjectId: reportId,
    before: { severity: before?.severity, status: before?.status },
    after: { severity, status: "triaged" },
  });

  revalidatePath("/admin/safeguarding");
  redirect(`/admin/safeguarding/${reportId}?ok=Report+triaged`);
}

// ---------------------------------------------------------------------------
// Add event (note, assignment change)
// ---------------------------------------------------------------------------

export async function addReportEvent(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const reportId = formData.get("reportId") as string;
  const eventType = formData.get("eventType") as string;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const newStatus = (formData.get("newStatus") as string) || null;
  const assignedTo = (formData.get("assignedTo") as string) || null;

  if (!reportId || !eventType) {
    redirect(
      `/admin/safeguarding?error=${encodeURIComponent("Invalid request")}`,
    );
  }

  const admin = createAdminClient();

  await admin.from("safeguarding_report_events").insert({
    report_id: reportId,
    actor_id: adminId,
    event_type: eventType,
    details: { notes, assigned_to: assignedTo },
  });

  // Update report status if a new status was provided
  if (newStatus) {
    await admin
      .from("safeguarding_reports")
      .update({ status: newStatus })
      .eq("id", reportId);
  }

  if (assignedTo) {
    await admin
      .from("safeguarding_reports")
      .update({ assigned_to: assignedTo })
      .eq("id", reportId);
  }

  await recordAuditEvent({
    action: `safeguarding_event_${eventType}`,
    subjectTable: "safeguarding_reports",
    subjectId: reportId,
    after: { event_type: eventType },
  });

  revalidatePath("/admin/safeguarding");
  redirect(`/admin/safeguarding/${reportId}?ok=Event+added`);
}

// ---------------------------------------------------------------------------
// Escalate: record statutory escalation
// ---------------------------------------------------------------------------

export async function escalateReport(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const reportId = formData.get("reportId") as string;
  const escalationTarget = (formData.get("escalationTarget") as string)?.trim();
  const justification = (formData.get("justification") as string)?.trim();

  if (!reportId || !escalationTarget || !justification) {
    redirect(
      `/admin/safeguarding/${reportId}?error=${encodeURIComponent("Escalation target and justification required")}`,
    );
  }

  const admin = createAdminClient();

  const { data: before } = await admin
    .from("safeguarding_reports")
    .select("status")
    .eq("id", reportId)
    .single();

  await admin
    .from("safeguarding_reports")
    .update({ status: "escalated" })
    .eq("id", reportId);

  await admin.from("safeguarding_report_events").insert({
    report_id: reportId,
    actor_id: adminId,
    event_type: "escalate",
    details: {
      escalation_target: escalationTarget,
      justification,
    },
  });

  await recordAuditEvent({
    action: "safeguarding_report_escalated",
    subjectTable: "safeguarding_reports",
    subjectId: reportId,
    before: { status: before?.status },
    after: { status: "escalated", escalation_target: escalationTarget },
  });

  revalidatePath("/admin/safeguarding");
  redirect(`/admin/safeguarding/${reportId}?ok=Report+escalated`);
}

// ---------------------------------------------------------------------------
// Resolve: admin resolves with notes
// ---------------------------------------------------------------------------

export async function resolveReport(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const reportId = formData.get("reportId") as string;
  const resolutionNotes = (formData.get("resolutionNotes") as string)?.trim();

  if (!reportId || !resolutionNotes) {
    redirect(
      `/admin/safeguarding/${reportId}?error=${encodeURIComponent("Resolution notes required")}`,
    );
  }

  const admin = createAdminClient();

  const { data: before } = await admin
    .from("safeguarding_reports")
    .select("status")
    .eq("id", reportId)
    .single();

  await admin
    .from("safeguarding_reports")
    .update({ status: "resolved" })
    .eq("id", reportId);

  await admin.from("safeguarding_report_events").insert({
    report_id: reportId,
    actor_id: adminId,
    event_type: "resolve",
    details: { resolution_notes: resolutionNotes },
  });

  await recordAuditEvent({
    action: "safeguarding_report_resolved",
    subjectTable: "safeguarding_reports",
    subjectId: reportId,
    before: { status: before?.status },
    after: { status: "resolved" },
  });

  revalidatePath("/admin/safeguarding");
  redirect(`/admin/safeguarding/${reportId}?ok=Report+resolved`);
}
