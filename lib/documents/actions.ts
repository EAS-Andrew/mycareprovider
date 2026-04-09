"use server";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import { assertAllowedUpload } from "./mime";
import { assertSniffedMime } from "./sniff";
import {
  PROVIDER_DOCS_BUCKET,
  isDocumentKind,
  type DocumentKind,
  type ProviderDocumentRow,
  type UploadProviderDocumentResult,
} from "./types";

/**
 * C3a provider document actions.
 *
 * Uploads and inserts are performed through the user-scoped Supabase client
 * so storage.objects RLS (INSERT on quarantine/<auth.uid()>/...) and the
 * documents owner_insert policy are the enforcement boundary. The admin
 * client is a fallback only, and the fallback path MUST re-check role
 * server-side before touching the service-role key.
 *
 * Non-async exports (constants, type aliases, kind guard) live in
 * `./types` so client components can import them without crossing the
 * "use server" boundary.
 */

function safeFilename(name: string): string {
  // M-6: preserve a transliterated / percent-encoded UTF-8 base rather than
  // collapsing all non-ASCII to underscores. Strip path separators and
  // control chars first, then percent-encode the remainder so CJK, emoji,
  // and accented characters stay round-trippable when the filename is
  // later rendered in admin tooling. Path traversal is still neutralised
  // because `/` and `\` are removed before encoding, and RLS only inspects
  // the second path segment (the caller's uid).
  const base = name.split(/[\\/]/).pop() ?? "file";
  // Drop ASCII control chars and the characters that would break a URL
  // path segment in storage keys.
  // eslint-disable-next-line no-control-regex
  const stripped = base.replace(/[\x00-\x1f\x7f"#%&'<>?`{}|]+/g, "");
  const encoded = encodeURIComponent(stripped).replace(/\*/g, "%2A");
  const trimmed = encoded.replace(/^[._-]+|[._-]+$/g, "");
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "file";
}

export async function uploadProviderDocument(
  formData: FormData,
): Promise<UploadProviderDocumentResult> {
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

  // H-1: the browser-supplied `file.type` is attacker-controlled. Sniff
  // the first 16 bytes server-side and reject on mismatch. The sniffed
  // value becomes the authoritative mime we persist and hand to storage
  // as `contentType`, so a mislabelled binary cannot later be served as
  // a PDF.
  const sniffedMime = await assertSniffedMime(file, file.type);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("sign-in-required");
  }

  // H-2: authoritative role from profiles.role. user_metadata.role is
  // user-writable and cannot be trusted for any authorization decision,
  // least of all for a path that may escalate to the admin client below.
  const callerRole = await getCurrentRole(supabase, user);

  if (callerRole !== "provider" && callerRole !== "provider_company") {
    throw new Error("provider-required");
  }

  const profileId = user.id;
  const objectName = `${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const storagePath = `quarantine/${profileId}/${objectName}`;

  // Primary path: user-scoped client, so storage RLS enforces that the
  // caller can only drop files into quarantine/<their-uid>/...
  const upload = await supabase.storage
    .from(PROVIDER_DOCS_BUCKET)
    .upload(storagePath, file, {
      contentType: sniffedMime,
      upsert: false,
    });

  if (upload.error) {
    // Admin fallback. We already re-read `user` and re-checked role above,
    // so the service-role key is only reachable after the owner boundary
    // has been validated on the server. Log the fallback so we can spot
    // RLS misconfigurations in production.
    console.warn(
      `uploadProviderDocument: user-scoped upload failed, falling back to admin client: ${upload.error.message}`,
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

  // Insert the row through the user-scoped client so documents_owner_insert
  // is the authoritative check. The AFTER INSERT trigger creates the
  // pending verifications row automatically.
  // TODO: compute sha256 of the upload and persist it here. Not MVP-blocking
  // for C3a; tracked under W2 audit trail hardening.
  const { data: inserted, error: insertError } = await supabase
    .from("documents")
    .insert({
      uploaded_by: profileId,
      provider_id: profileId,
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
    // Best-effort cleanup: the storage object is orphaned if the row insert
    // failed. Use the admin client so a subsequent RLS regression cannot
    // silently leave debris in the bucket.
    try {
      const admin = createAdminClient();
      await admin.storage.from(PROVIDER_DOCS_BUCKET).remove([storagePath]);
    } catch {
      // swallow - the primary error is what the caller needs to see
    }
    throw new Error(
      `insert failed: ${insertError?.message ?? "unknown error"}`,
    );
  }

  const documentId = inserted.id as string;

  await recordAuditEvent({
    action: "document.upload",
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

type ListDocumentsRow = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  mime_type: string;
  size_bytes: number;
  status: string;
  rejected_reason: string | null;
  expires_at: string | null;
  created_at: string;
  verifications:
    | {
        state: string;
        notes: string | null;
        reviewed_at: string | null;
      }
    | Array<{
        state: string;
        notes: string | null;
        reviewed_at: string | null;
      }>
    | null;
};

export async function listOwnDocuments(): Promise<ProviderDocumentRow[]> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, kind, title, description, mime_type, size_bytes, status, rejected_reason, expires_at, created_at, verifications ( state, notes, reviewed_at )",
    )
    .eq("uploaded_by", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`listOwnDocuments: ${error.message}`);
  }

  const rows = (data ?? []) as ListDocumentsRow[];

  return rows.map((row) => {
    const verification = Array.isArray(row.verifications)
      ? (row.verifications[0] ?? null)
      : row.verifications;
    return {
      id: row.id,
      kind: row.kind as DocumentKind,
      title: row.title,
      description: row.description,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      status: row.status as ProviderDocumentRow["status"],
      rejected_reason: row.rejected_reason,
      expires_at: row.expires_at,
      created_at: row.created_at,
      verification_state:
        (verification?.state as ProviderDocumentRow["verification_state"]) ??
        null,
      verification_notes: verification?.notes ?? null,
      verification_reviewed_at: verification?.reviewed_at ?? null,
    };
  });
}

export async function softDeleteDocument(documentId: string): Promise<void> {
  if (!documentId) {
    throw new Error("Missing documentId");
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("sign-in-required");
  }

  // documents_owner_soft_delete policy scopes the UPDATE to the caller's own
  // rows and forces deleted_at to non-null. tg_documents_guard freezes every
  // other column on the owner path, so this is the only legal owner write.
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("uploaded_by", user.id);

  if (error) {
    throw new Error(`softDeleteDocument: ${error.message}`);
  }

  await recordAuditEvent({
    action: "document.soft_delete",
    subjectTable: "public.documents",
    subjectId: documentId,
  });
}
