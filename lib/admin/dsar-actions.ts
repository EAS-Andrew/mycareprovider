"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

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
// Process DSAR request (mark processing / completed / rejected)
// ---------------------------------------------------------------------------

export async function processDsarRequest(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const requestId = formData.get("requestId") as string;
  const action = formData.get("action") as string;
  const rejectionReason = (formData.get("rejectionReason") as string) || null;

  if (
    !requestId ||
    !["processing", "completed", "rejected"].includes(action)
  ) {
    redirect(
      `/admin/dsar?error=${encodeURIComponent("Invalid request")}`,
    );
  }

  const admin = createAdminClient();

  // Read before state
  const { data: before } = await admin
    .from("dsar_requests")
    .select("status")
    .eq("id", requestId)
    .single();

  const updatePayload: Record<string, unknown> = {
    status: action,
    processed_by: adminId,
  };

  if (action === "completed" || action === "rejected") {
    updatePayload.processed_at = new Date().toISOString();
  }

  if (action === "rejected" && rejectionReason) {
    updatePayload.rejection_reason = rejectionReason;
  }

  const { error } = await admin
    .from("dsar_requests")
    .update(updatePayload)
    .eq("id", requestId);

  if (error) {
    redirect(
      `/admin/dsar/${requestId}?error=${encodeURIComponent(error.message)}`,
    );
  }

  await recordAuditEvent({
    action: `dsar_${action}`,
    subjectTable: "dsar_requests",
    subjectId: requestId,
    before: { status: before?.status },
    after: { status: action },
  });

  revalidatePath("/admin/dsar");
  redirect(`/admin/dsar?ok=Request+${action}`);
}

// ---------------------------------------------------------------------------
// Process erasure (admin triggers soft-delete cascade after cool-off)
// ---------------------------------------------------------------------------

export async function processErasure(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const erasureId = formData.get("erasureId") as string;

  if (!erasureId) {
    redirect(
      `/admin/dsar?error=${encodeURIComponent("Missing erasure ID")}`,
    );
  }

  const admin = createAdminClient();

  // Fetch the erasure request
  const { data: erasure } = await admin
    .from("erasure_requests")
    .select("id, requester_id, status, cooloff_ends_at, dsar_request_id")
    .eq("id", erasureId)
    .single();

  if (!erasure) {
    redirect(
      `/admin/dsar?error=${encodeURIComponent("Erasure request not found")}`,
    );
  }

  // Verify cool-off has expired
  if (new Date(erasure.cooloff_ends_at) > new Date()) {
    redirect(
      `/admin/dsar/${erasure.dsar_request_id}?error=${encodeURIComponent("Cool-off period has not expired yet")}`,
    );
  }

  if (
    erasure.status !== "cooloff_expired" &&
    erasure.status !== "pending_cooloff"
  ) {
    redirect(
      `/admin/dsar/${erasure.dsar_request_id}?error=${encodeURIComponent("This erasure request cannot be processed in its current state")}`,
    );
  }

  const now = new Date().toISOString();
  const userId = erasure.requester_id;

  // Build legal holds for records we must retain
  const legalHolds = [
    {
      table: "audit_log",
      reason: "Append-only audit trail exempt from erasure",
      retention_until: "indefinite",
    },
  ];

  // Soft-delete cascade across regulated tables.
  // Each table that the user owns rows in gets deleted_at stamped.
  // Exempt: audit_log (append-only), safeguarding_reports (C25 exempt).
  const softDeleteTables = [
    { table: "contact_thread_posts", column: "author_id" },
    { table: "contact_requests", column: "receiver_id" },
    { table: "care_circle_members", column: "member_id" },
    { table: "company_memberships", column: "member_id" },
    { table: "documents", column: "provider_id" },
    { table: "documents", column: "receiver_id" },
    { table: "provider_profiles", column: "id" },
    { table: "provider_companies", column: "id" },
    { table: "receiver_profiles", column: "id" },
    { table: "family_authorisations", column: "family_member_id" },
    { table: "care_circles", column: "receiver_id" },
    { table: "profiles", column: "id" },
  ];

  for (const { table, column } of softDeleteTables) {
    await admin
      .from(table)
      .update({ deleted_at: now })
      .eq(column, userId)
      .is("deleted_at", null);
  }

  // Also soft-delete contact requests where user is provider
  await admin
    .from("contact_requests")
    .update({ deleted_at: now })
    .eq("provider_id", userId)
    .is("deleted_at", null);

  // Mark erasure request as completed
  await admin
    .from("erasure_requests")
    .update({
      status: "completed",
      processed_at: now,
      processed_by: adminId,
      legal_holds: legalHolds,
    })
    .eq("id", erasureId);

  // Mark parent DSAR request as completed
  await admin
    .from("dsar_requests")
    .update({
      status: "completed",
      processed_at: now,
      processed_by: adminId,
    })
    .eq("id", erasure.dsar_request_id);

  await recordAuditEvent({
    action: "erasure_completed",
    subjectTable: "erasure_requests",
    subjectId: erasureId,
    before: { status: erasure.status },
    after: {
      status: "completed",
      erased_user: userId,
      legal_holds: legalHolds,
    },
  });

  revalidatePath("/admin/dsar");
  redirect(`/admin/dsar?ok=Erasure+completed`);
}

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

export type PendingDsarRequest = {
  id: string;
  requester_id: string;
  request_type: "access" | "erasure";
  status: string;
  requested_at: string;
  created_at: string;
  requester: { display_name: string | null; email: string | null } | null;
};

export async function getPendingDsarRequests(): Promise<PendingDsarRequest[]> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("sign-in-required");

  const role = await getCurrentRole(supabase, user);
  if (role !== "admin") throw new Error("admin-required");

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("dsar_requests")
    .select(
      `id, requester_id, request_type, status, requested_at, created_at,
       requester:profiles!dsar_requests_requester_id_fkey(display_name, email)`,
    )
    .in("status", ["pending", "processing"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PendingDsarRequest[];
}

export type DsarRequestForReview = {
  id: string;
  requester_id: string;
  request_type: "access" | "erasure";
  status: string;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  download_url: string | null;
  download_expires_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  requester: { display_name: string | null; email: string | null } | null;
  erasure_request: {
    id: string;
    status: string;
    cooloff_ends_at: string;
    legal_holds: Array<{
      table: string;
      reason: string;
      retention_until: string;
    }>;
    processed_at: string | null;
  } | null;
};

export async function getDsarRequestForReview(
  requestId: string,
): Promise<DsarRequestForReview | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const role = await getCurrentRole(supabase, user);
  if (role !== "admin") return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("dsar_requests")
    .select(
      `id, requester_id, request_type, status, requested_at, processed_at,
       processed_by, download_url, download_expires_at, rejection_reason, notes,
       created_at,
       requester:profiles!dsar_requests_requester_id_fkey(display_name, email),
       erasure_request:erasure_requests(id, status, cooloff_ends_at, legal_holds, processed_at)`,
    )
    .eq("id", requestId)
    .is("deleted_at", null)
    .single();

  if (error) return null;

  // Supabase returns array for the join; take first item
  const row = data as Record<string, unknown>;
  const erasureArr = row.erasure_request as unknown[];
  return {
    ...(row as unknown as DsarRequestForReview),
    erasure_request: erasureArr?.length
      ? (erasureArr[0] as DsarRequestForReview["erasure_request"])
      : null,
  };
}
