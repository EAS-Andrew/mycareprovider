"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Gate: reads the caller's role from profiles (never user_metadata), throws
 * if not admin. Returns the authenticated user id for audit stamping.
 */
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
// Review a document verification (approve / reject with notes)
// ---------------------------------------------------------------------------

export async function reviewDocument(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const verificationId = formData.get("verificationId") as string;
  const decision = formData.get("decision") as string;
  const notes = (formData.get("notes") as string) || null;

  if (!verificationId || !["approved", "rejected"].includes(decision)) {
    redirect(
      `/admin/verification/providers?error=${encodeURIComponent("Invalid request")}`,
    );
  }

  const admin = createAdminClient();

  // Read before state
  const { data: before } = await admin
    .from("verifications")
    .select("state")
    .eq("id", verificationId)
    .single();

  const { error } = await admin
    .from("verifications")
    .update({
      state: decision,
      notes,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", verificationId);

  if (error) {
    redirect(
      `/admin/verification/providers?error=${encodeURIComponent(error.message)}`,
    );
  }

  await recordAuditEvent({
    action: `verification_${decision}`,
    subjectTable: "verifications",
    subjectId: verificationId,
    before: { state: before?.state },
    after: { state: decision },
  });

  revalidatePath("/admin/verification");
  redirect("/admin/verification/providers?ok=Document+reviewed");
}

// ---------------------------------------------------------------------------
// Verify a provider (stamp verified_at)
// ---------------------------------------------------------------------------

export async function verifyProvider(formData: FormData): Promise<void> {
  await requireAdmin();
  const providerId = formData.get("providerId") as string;
  if (!providerId) {
    redirect(
      `/admin/verification/providers?error=${encodeURIComponent("Missing provider ID")}`,
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("provider_profiles")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", providerId)
    .is("verified_at", null);

  if (error) {
    redirect(
      `/admin/verification/providers/${providerId}?error=${encodeURIComponent(error.message)}`,
    );
  }

  await recordAuditEvent({
    action: "verify_provider",
    subjectTable: "provider_profiles",
    subjectId: providerId,
    before: { verified_at: null },
    after: { verified_at: "now" },
  });

  revalidatePath("/admin/verification");
  redirect(`/admin/verification/providers/${providerId}?ok=Provider+verified`);
}

// ---------------------------------------------------------------------------
// Verify a company (stamp verified_at)
// ---------------------------------------------------------------------------

export async function verifyCompany(formData: FormData): Promise<void> {
  await requireAdmin();
  const companyId = formData.get("companyId") as string;
  if (!companyId) {
    redirect(
      `/admin/verification/companies?error=${encodeURIComponent("Missing company ID")}`,
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("provider_companies")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", companyId)
    .is("verified_at", null);

  if (error) {
    redirect(
      `/admin/verification/companies/${companyId}?error=${encodeURIComponent(error.message)}`,
    );
  }

  await recordAuditEvent({
    action: "verify_company",
    subjectTable: "provider_companies",
    subjectId: companyId,
    before: { verified_at: null },
    after: { verified_at: "now" },
  });

  revalidatePath("/admin/verification");
  redirect(`/admin/verification/companies/${companyId}?ok=Company+verified`);
}

// ---------------------------------------------------------------------------
// Verify a family authorisation (stamp verified_at / verified_by)
// ---------------------------------------------------------------------------

export async function verifyFamilyAuthorisation(
  formData: FormData,
): Promise<void> {
  const adminId = await requireAdmin();
  const authorisationId = formData.get("authorisationId") as string;
  if (!authorisationId) {
    redirect(
      `/admin/verification/family?error=${encodeURIComponent("Missing authorisation ID")}`,
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("family_authorisations")
    .update({
      verified_at: new Date().toISOString(),
      verified_by: adminId,
    })
    .eq("id", authorisationId)
    .is("verified_at", null);

  if (error) {
    redirect(
      `/admin/verification/family/${authorisationId}?error=${encodeURIComponent(error.message)}`,
    );
  }

  await recordAuditEvent({
    action: "verify_family_authorisation",
    subjectTable: "family_authorisations",
    subjectId: authorisationId,
    before: { verified_at: null },
    after: { verified_at: "now" },
  });

  revalidatePath("/admin/verification");
  redirect(
    `/admin/verification/family/${authorisationId}?ok=Authorisation+verified`,
  );
}
