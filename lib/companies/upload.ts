"use server";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { assertAllowedUpload } from "@/lib/documents/mime";
import { assertSniffedMime } from "@/lib/documents/sniff";
import { PROVIDER_DOCS_BUCKET } from "@/lib/documents/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import type { DocumentKind } from "@/lib/documents/types";
import { isDocumentKind } from "@/lib/documents/types";

/**
 * Upload a document attributed to the caller's company (provider_company_id).
 * Mirrors uploadProviderDocument but sets provider_company_id instead of
 * provider_id.
 */

function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const stripped = base.replace(/[\x00-\x1f\x7f"#%&'<>?`{}|]+/g, "");
  const encoded = encodeURIComponent(stripped).replace(/\*/g, "%2A");
  const trimmed = encoded.replace(/^[._-]+|[._-]+$/g, "");
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "file";
}

export async function uploadCompanyDocument(
  formData: FormData,
): Promise<{ documentId: string }> {
  const kindRaw = formData.get("kind");
  if (typeof kindRaw !== "string" || !isDocumentKind(kindRaw)) {
    throw new Error("Invalid document kind");
  }
  const kind: DocumentKind = kindRaw;

  const title = formData.get("title");
  if (typeof title !== "string" || title.length === 0) {
    throw new Error("Missing form field: title");
  }

  const descriptionRaw = formData.get("description");
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.length > 0
      ? descriptionRaw
      : null;

  const expiresAtRaw = formData.get("expires_at");
  const expiresAt =
    typeof expiresAtRaw === "string" && expiresAtRaw.length > 0
      ? expiresAtRaw
      : null;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Missing form field: file");
  }

  assertAllowedUpload({ mimeType: file.type, sizeBytes: file.size });
  const sniffedMime = await assertSniffedMime(file, file.type);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("sign-in-required");
  }

  const callerRole = await getCurrentRole(supabase, user);
  if (callerRole !== "provider_company") {
    throw new Error("company-required");
  }

  const profileId = user.id;
  const objectName = `${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const storagePath = `quarantine/${profileId}/${objectName}`;

  const upload = await supabase.storage
    .from(PROVIDER_DOCS_BUCKET)
    .upload(storagePath, file, {
      contentType: sniffedMime,
      upsert: false,
    });

  if (upload.error) {
    console.warn(
      `uploadCompanyDocument: user-scoped upload failed, falling back to admin client: ${upload.error.message}`,
    );
    const admin = createAdminClient();
    const adminUpload = await admin.storage
      .from(PROVIDER_DOCS_BUCKET)
      .upload(storagePath, file, {
        contentType: sniffedMime,
        upsert: false,
      });
    if (adminUpload.error) {
      throw new Error(`upload failed: ${adminUpload.error.message}`);
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("documents")
    .insert({
      uploaded_by: profileId,
      provider_company_id: profileId,
      kind,
      title,
      description,
      storage_bucket: PROVIDER_DOCS_BUCKET,
      storage_path: storagePath,
      mime_type: sniffedMime,
      size_bytes: file.size,
      sha256: null,
      status: "quarantined",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    try {
      const admin = createAdminClient();
      await admin.storage.from(PROVIDER_DOCS_BUCKET).remove([storagePath]);
    } catch {
      // swallow
    }
    throw new Error(
      `insert failed: ${insertError?.message ?? "unknown error"}`,
    );
  }

  const documentId = inserted.id as string;

  await recordAuditEvent({
    action: "company.document.upload",
    subjectTable: "public.documents",
    subjectId: documentId,
    after: {
      kind,
      title,
      expires_at: expiresAt,
      size_bytes: file.size,
    },
  });

  return { documentId };
}
