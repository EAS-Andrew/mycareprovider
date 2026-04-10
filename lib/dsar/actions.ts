"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { generateDataExport } from "@/lib/dsar/export";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAuth(): Promise<string> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("sign-in-required");
  return user.id;
}

/** Detect the caller's settings route prefix based on role. */
async function settingsPath(): Promise<string> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/auth/sign-in";

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (
    data?.role === "provider" ||
    data?.role === "provider_company"
  ) {
    return "/provider/settings/data";
  }
  return "/receiver/settings/data";
}

// ---------------------------------------------------------------------------
// Request data export (DSAR access request)
// ---------------------------------------------------------------------------

export async function requestDataExport(): Promise<void> {
  const userId = await requireAuth();
  const supabase = await createServerClient();
  const returnPath = await settingsPath();

  // Insert the DSAR request (RLS enforces requester_id = current user;
  // unique partial index enforces one pending per type).
  const { data: dsarRequest, error: insertError } = await supabase
    .from("dsar_requests")
    .insert({
      requester_id: userId,
      request_type: "access",
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError) {
    const msg = insertError.message.includes("unique")
      ? "You already have a pending data export request"
      : insertError.message;
    redirect(`${returnPath}?error=${encodeURIComponent(msg)}`);
  }

  // Generate the export bundle
  const bundle = await generateDataExport(userId);
  const admin = createAdminClient();

  // Upload to private storage bucket
  const fileName = `${userId}/${dsarRequest.id}.json`;
  const { error: uploadError } = await admin.storage
    .from("dsar-exports")
    .upload(fileName, JSON.stringify(bundle, null, 2), {
      contentType: "application/json",
      upsert: false,
    });

  if (uploadError) {
    // Clean up the request on upload failure
    await admin
      .from("dsar_requests")
      .delete()
      .eq("id", dsarRequest.id);
    redirect(
      `${returnPath}?error=${encodeURIComponent("Failed to generate export. Please try again.")}`,
    );
  }

  // Generate a signed URL valid for 7 days
  const { data: signedUrl } = await admin.storage
    .from("dsar-exports")
    .createSignedUrl(fileName, 60 * 60 * 24 * 7);

  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Update the request with the download URL and mark completed
  await admin
    .from("dsar_requests")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
      download_url: signedUrl?.signedUrl ?? null,
      download_expires_at: expiresAt,
    })
    .eq("id", dsarRequest.id);

  await recordAuditEvent({
    action: "dsar_export_completed",
    subjectTable: "dsar_requests",
    subjectId: dsarRequest.id,
    after: { request_type: "access", status: "completed" },
  });

  revalidatePath(returnPath);
  redirect(`${returnPath}?ok=Your+data+export+is+ready+for+download`);
}

// ---------------------------------------------------------------------------
// Request erasure (right to erasure with 30-day cool-off)
// ---------------------------------------------------------------------------

export async function requestErasure(): Promise<void> {
  const userId = await requireAuth();
  const supabase = await createServerClient();
  const returnPath = await settingsPath();

  // Create the DSAR request
  const { data: dsarRequest, error: dsarError } = await supabase
    .from("dsar_requests")
    .insert({
      requester_id: userId,
      request_type: "erasure",
      status: "pending",
    })
    .select("id")
    .single();

  if (dsarError) {
    const msg = dsarError.message.includes("unique")
      ? "You already have a pending erasure request"
      : dsarError.message;
    redirect(`${returnPath}?error=${encodeURIComponent(msg)}`);
  }

  // Create the erasure request with cool-off period
  const { error: erasureError } = await supabase
    .from("erasure_requests")
    .insert({
      dsar_request_id: dsarRequest.id,
      requester_id: userId,
    });

  if (erasureError) {
    // Clean up the parent request
    const admin = createAdminClient();
    await admin
      .from("dsar_requests")
      .delete()
      .eq("id", dsarRequest.id);
    redirect(
      `${returnPath}?error=${encodeURIComponent(erasureError.message)}`,
    );
  }

  await recordAuditEvent({
    action: "erasure_requested",
    subjectTable: "dsar_requests",
    subjectId: dsarRequest.id,
    after: { request_type: "erasure", status: "pending" },
  });

  revalidatePath(returnPath);
  redirect(
    `${returnPath}?ok=Erasure+request+submitted.+You+have+30+days+to+cancel.`,
  );
}

// ---------------------------------------------------------------------------
// Cancel erasure (during cool-off only)
// ---------------------------------------------------------------------------

export async function cancelErasure(formData: FormData): Promise<void> {
  const userId = await requireAuth();
  const erasureId = formData.get("erasureId") as string;
  const returnPath = await settingsPath();

  if (!erasureId) {
    redirect(
      `${returnPath}?error=${encodeURIComponent("Missing erasure request ID")}`,
    );
  }

  const admin = createAdminClient();

  // Verify ownership and status
  const { data: erasure } = await admin
    .from("erasure_requests")
    .select("id, requester_id, status, dsar_request_id")
    .eq("id", erasureId)
    .single();

  if (!erasure || erasure.requester_id !== userId) {
    redirect(
      `${returnPath}?error=${encodeURIComponent("Erasure request not found")}`,
    );
  }

  if (erasure.status !== "pending_cooloff") {
    redirect(
      `${returnPath}?error=${encodeURIComponent("This erasure request can no longer be cancelled")}`,
    );
  }

  // Cancel the erasure request
  await admin
    .from("erasure_requests")
    .update({ status: "cancelled" })
    .eq("id", erasureId);

  // Also mark the parent DSAR request as rejected (user-cancelled)
  await admin
    .from("dsar_requests")
    .update({
      status: "rejected",
      rejection_reason: "Cancelled by user during cool-off period",
      processed_at: new Date().toISOString(),
    })
    .eq("id", erasure.dsar_request_id);

  await recordAuditEvent({
    action: "erasure_cancelled",
    subjectTable: "erasure_requests",
    subjectId: erasureId,
    before: { status: "pending_cooloff" },
    after: { status: "cancelled" },
  });

  revalidatePath(returnPath);
  redirect(`${returnPath}?ok=Erasure+request+cancelled`);
}
