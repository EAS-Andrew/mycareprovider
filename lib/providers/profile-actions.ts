"use server";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";

import {
  CatalogValidationError,
  type AddCertificationInput,
  type UpdateCertificationInput,
} from "./catalog";

/**
 * C6a profile mutation Server Actions (services, capabilities,
 * certifications). Deliberately kept in a separate file from C3a's
 * `lib/providers/actions.ts` so this component never has to touch the
 * C3a surface.
 *
 * Enforcement model mirrors C3a exactly: user-scoped Supabase client,
 * role gate re-evaluated on every call, W2 audit event recorded on every
 * mutation. No admin client - reference tables are world-read, linking
 * tables carry owner RLS, so the user-scoped client is the boundary.
 *
 * All errors are thrown as `CatalogValidationError` (defined in
 * `./catalog`) or a plain `Error` for unexpected failures; the UI
 * trampolines catch them and redirect to `?error=` in the shared
 * error-summary shape from `app/(public)/auth/sign-in/page.tsx`.
 */

type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>;

async function requireProvider(): Promise<{
  supabase: ServerSupabase;
  userId: string;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new CatalogValidationError(
      "sign-in-required",
      "You must sign in to continue",
    );
  }
  // H-2: authoritative role from profiles.role, never user_metadata.
  const role = await getCurrentRole(supabase, user);
  if (role !== "provider" && role !== "provider_company") {
    throw new CatalogValidationError(
      "provider-required",
      "This page is for care providers only",
    );
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

async function assertDocumentOwnership(
  supabase: ServerSupabase,
  userId: string,
  documentId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, kind, status, deleted_at")
    .eq("id", documentId)
    .eq("uploaded_by", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`assertDocumentOwnership: ${error.message}`);
  }
  if (!data) {
    throw new CatalogValidationError(
      "invalid_document",
      "Selected document was not found in your vault",
    );
  }
  if ((data.kind as string) !== "certification") {
    throw new CatalogValidationError(
      "invalid_document",
      "Linked document must be uploaded with kind 'certification'",
    );
  }
  if ((data.deleted_at as string | null) !== null) {
    throw new CatalogValidationError(
      "invalid_document",
      "Linked document has been deleted",
    );
  }
  // H-4: require status='available' so quarantined/rejected files cannot
  // be linked as "proof of certification". assertDocumentOwnership is the
  // shared guard for both add and update code paths.
  if ((data.status as string) !== "available") {
    throw new CatalogValidationError(
      "invalid_document",
      "Linked document must be scanned and approved before it can be attached",
    );
  }
}

export async function setProviderServices(
  serviceCategoryIds: string[],
): Promise<void> {
  const desired = normaliseIdList(serviceCategoryIds);
  const { supabase, userId } = await requireProvider();

  const { data: existingRows, error: fetchErr } = await supabase
    .from("provider_services")
    .select("service_category_id")
    .eq("provider_id", userId);
  if (fetchErr) {
    throw new Error(`setProviderServices fetch: ${fetchErr.message}`);
  }

  const existing = (
    (existingRows ?? []) as { service_category_id: string }[]
  ).map((r) => r.service_category_id);
  const { toInsert, toDelete } = diffIdSets(existing, desired);

  // Delete first so the audit log always sees a coherent "before" set even
  // if the insert leg partially fails on an unknown FK value. RLS scopes
  // the DELETE to the caller's own rows, so we cannot accidentally wipe
  // another provider's row through this path.
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("provider_services")
      .delete()
      .eq("provider_id", userId)
      .in("service_category_id", toDelete);
    if (error) {
      throw new Error(`setProviderServices delete: ${error.message}`);
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("provider_services").insert(
      toInsert.map((service_category_id) => ({
        provider_id: userId,
        service_category_id,
      })),
    );
    if (error) {
      throw new CatalogValidationError(
        "invalid_service",
        `Could not save services: ${error.message}`,
      );
    }
  }

  await recordAuditEvent({
    action: "provider.services.set",
    subjectTable: "public.provider_services",
    subjectId: userId,
    before: { ids: existing },
    after: { ids: desired, added: toInsert, removed: toDelete },
  });
}

export async function setProviderCapabilities(
  capabilityIds: string[],
): Promise<void> {
  const desired = normaliseIdList(capabilityIds);
  const { supabase, userId } = await requireProvider();

  const { data: existingRows, error: fetchErr } = await supabase
    .from("provider_capabilities")
    .select("capability_id")
    .eq("provider_id", userId);
  if (fetchErr) {
    throw new Error(`setProviderCapabilities fetch: ${fetchErr.message}`);
  }

  const existing = (
    (existingRows ?? []) as { capability_id: string }[]
  ).map((r) => r.capability_id);
  const { toInsert, toDelete } = diffIdSets(existing, desired);

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("provider_capabilities")
      .delete()
      .eq("provider_id", userId)
      .in("capability_id", toDelete);
    if (error) {
      throw new Error(`setProviderCapabilities delete: ${error.message}`);
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("provider_capabilities").insert(
      toInsert.map((capability_id) => ({
        provider_id: userId,
        capability_id,
      })),
    );
    if (error) {
      throw new CatalogValidationError(
        "invalid_capability",
        `Could not save capabilities: ${error.message}`,
      );
    }
  }

  await recordAuditEvent({
    action: "provider.capabilities.set",
    subjectTable: "public.provider_capabilities",
    subjectId: userId,
    before: { ids: existing },
    after: { ids: desired, added: toInsert, removed: toDelete },
  });
}

export async function addProviderCertification(
  input: AddCertificationInput,
): Promise<void> {
  const certificationId = input.certificationId?.trim() ?? "";
  if (certificationId.length === 0) {
    throw new CatalogValidationError(
      "certification_required",
      "Choose a certification type",
    );
  }

  const { supabase, userId } = await requireProvider();

  const { data: certMeta, error: certErr } = await supabase
    .from("certifications")
    .select("id, expires")
    .eq("id", certificationId)
    .maybeSingle();
  if (certErr) {
    throw new Error(`addProviderCertification lookup: ${certErr.message}`);
  }
  if (!certMeta) {
    throw new CatalogValidationError(
      "certification_not_found",
      "Unknown certification type",
    );
  }

  const reference = input.reference?.trim() || null;
  const issuedOn = input.issuedOn?.trim() || null;
  const expiresOn = input.expiresOn?.trim() || null;
  const documentId = input.documentId?.trim() || null;

  if ((certMeta.expires as boolean) === true && expiresOn === null) {
    throw new CatalogValidationError(
      "expiry_required",
      "This certification requires an expiry date",
    );
  }
  if (expiresOn !== null && issuedOn !== null && expiresOn < issuedOn) {
    throw new CatalogValidationError(
      "expiry_before_issue",
      "Expiry date must be on or after the issue date",
    );
  }

  if (documentId !== null) {
    await assertDocumentOwnership(supabase, userId, documentId);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("provider_certifications")
    .insert({
      provider_id: userId,
      certification_id: certificationId,
      reference,
      issued_on: issuedOn,
      expires_on: expiresOn,
      document_id: documentId,
    })
    .select("id")
    .single();

  if (insertErr) {
    // 23505 = unique_violation. The partial-unique index on
    // (provider_id, certification_id) WHERE deleted_at IS NULL means the
    // caller already has this certification type. Surface a friendly
    // message rather than leaking the Postgres SQLSTATE.
    const code = (insertErr as unknown as { code?: string }).code;
    if (code === "23505") {
      throw new CatalogValidationError(
        "already_present",
        "You already have this certification. Edit or remove the existing entry first.",
      );
    }
    throw new Error(`addProviderCertification insert: ${insertErr.message}`);
  }

  const insertedId = (inserted as { id: string } | null)?.id;
  if (!insertedId) {
    throw new Error("addProviderCertification: insert returned no id");
  }

  await recordAuditEvent({
    action: "provider.certification.add",
    subjectTable: "public.provider_certifications",
    subjectId: insertedId,
    after: {
      certification_id: certificationId,
      issued_on: issuedOn,
      expires_on: expiresOn,
      has_document: documentId !== null,
    },
  });
}

export async function updateProviderCertification(
  id: string,
  patch: UpdateCertificationInput,
): Promise<void> {
  const rowId = id?.trim() ?? "";
  if (rowId.length === 0) {
    throw new CatalogValidationError(
      "not_found",
      "Certification id is required",
    );
  }

  const { supabase, userId } = await requireProvider();

  const { data: existing, error: fetchErr } = await supabase
    .from("provider_certifications")
    .select(
      "id, certification_id, reference, issued_on, expires_on, document_id, deleted_at",
    )
    .eq("id", rowId)
    .eq("provider_id", userId)
    .maybeSingle();
  if (fetchErr) {
    throw new Error(`updateProviderCertification fetch: ${fetchErr.message}`);
  }
  if (!existing || (existing.deleted_at as string | null) !== null) {
    throw new CatalogValidationError(
      "not_found",
      "Certification not found",
    );
  }

  const { data: certMeta, error: certErr } = await supabase
    .from("certifications")
    .select("expires")
    .eq("id", existing.certification_id as string)
    .maybeSingle();
  if (certErr) {
    throw new Error(`updateProviderCertification lookup: ${certErr.message}`);
  }

  const reference =
    patch.reference !== undefined
      ? (patch.reference?.trim() || null)
      : (existing.reference as string | null);
  const issuedOn =
    patch.issuedOn !== undefined
      ? (patch.issuedOn?.trim() || null)
      : (existing.issued_on as string | null);
  const expiresOn =
    patch.expiresOn !== undefined
      ? (patch.expiresOn?.trim() || null)
      : (existing.expires_on as string | null);
  const documentId =
    patch.documentId !== undefined
      ? (patch.documentId?.trim() || null)
      : (existing.document_id as string | null);

  if ((certMeta?.expires as boolean | undefined) === true && expiresOn === null) {
    throw new CatalogValidationError(
      "expiry_required",
      "This certification requires an expiry date",
    );
  }
  if (expiresOn !== null && issuedOn !== null && expiresOn < issuedOn) {
    throw new CatalogValidationError(
      "expiry_before_issue",
      "Expiry date must be on or after the issue date",
    );
  }

  if (patch.documentId !== undefined && documentId !== null) {
    await assertDocumentOwnership(supabase, userId, documentId);
  }

  const { error: updateErr } = await supabase
    .from("provider_certifications")
    .update({
      reference,
      issued_on: issuedOn,
      expires_on: expiresOn,
      document_id: documentId,
    })
    .eq("id", rowId)
    .eq("provider_id", userId);
  if (updateErr) {
    throw new Error(`updateProviderCertification update: ${updateErr.message}`);
  }

  await recordAuditEvent({
    action: "provider.certification.update",
    subjectTable: "public.provider_certifications",
    subjectId: rowId,
    before: {
      issued_on: existing.issued_on,
      expires_on: existing.expires_on,
      has_document: (existing.document_id as string | null) !== null,
    },
    after: {
      issued_on: issuedOn,
      expires_on: expiresOn,
      has_document: documentId !== null,
    },
  });
}

export async function softDeleteProviderCertification(
  id: string,
): Promise<void> {
  const rowId = id?.trim() ?? "";
  if (rowId.length === 0) {
    throw new CatalogValidationError(
      "not_found",
      "Certification id is required",
    );
  }

  const { supabase, userId } = await requireProvider();

  // Soft-delete must go through UPDATE: the BEFORE DELETE guard trigger on
  // provider_certifications rejects hard-delete for non-admin callers. The
  // owner_update RLS policy scopes this to the caller's own rows.
  const { data: updated, error } = await supabase
    .from("provider_certifications")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", rowId)
    .eq("provider_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`softDeleteProviderCertification: ${error.message}`);
  }
  if (!updated) {
    throw new CatalogValidationError(
      "not_found",
      "Certification not found",
    );
  }

  await recordAuditEvent({
    action: "provider.certification.soft_delete",
    subjectTable: "public.provider_certifications",
    subjectId: rowId,
  });
}
