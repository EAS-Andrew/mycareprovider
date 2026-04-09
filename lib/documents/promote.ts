import "server-only";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";

import { PROVIDER_DOCS_BUCKET } from "./types";

/**
 * STUB: quarantine -> clean promote step.
 *
 * The full virus-scan pipeline described in `docs/pid.md` is not in scope
 * for this ticket. A later component will wire this into a Vercel Cron
 * that pulls quarantined objects, fans them through a scanner (ClamAV or
 * hosted equivalent), and calls `promoteQuarantinedDocument` on clean
 * results or `__forceRejectDocument` on dirty ones.
 *
 * This file intentionally bypasses RLS via the admin client - every
 * caller must have already authorized the operation out-of-band. It is
 * NOT a Server Action and must not be imported by form endpoints.
 *
 * C-2: promote is structurally gated on an explicit `scanVerdict: 'clean'`
 * argument. No current caller supplies it, so the reachable promote path
 * is effectively disabled until the scanner integration lands. This is
 * the non-migration variant of the fix: we do not depend on a new
 * `scan_status` column, so no migration coordination is required.
 *
 * W2 audit trail: every success and failure leg writes an audit event via
 * `recordSystemAudit`, which calls `app.record_system_audit` when the
 * RPC is present in the database and falls back to a warn-and-continue
 * otherwise (coordinated with sql-fixer for migration 0009).
 */

export type PromoteResult =
  | { status: "available" }
  | { status: "rejected"; reason: string }
  | { status: "noop"; reason: string };

export type ScanVerdict = "clean" | "infected";

export type PromoteOptions = {
  /**
   * The scanner's verdict. Promote is only allowed when this is `"clean"`.
   * Callers without a scanner verdict must not call this function. Passing
   * any other value or omitting the field results in a `noop` - the
   * function cannot flip `status=available` without an explicit clean
   * verdict from an upstream scanner.
   */
  scanVerdict: ScanVerdict;
  /**
   * Optional free-text identifier for the scanner run so the audit log
   * can correlate promote events with scanner output.
   */
  scanRef?: string | null;
};

/**
 * Best-effort system audit via the `app.record_system_audit` RPC. When
 * the RPC is missing (migration 0009 not yet applied, or the RPC name
 * was renamed) we log a single warning and continue - audit backfill is
 * handled out-of-band. Every promote/reject call writes one of these so
 * the W2 trail sees both success and failure legs.
 */
async function recordSystemAudit(params: {
  action: string;
  subjectTable: string;
  subjectId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const admin = createAdminClient();
  try {
    const { error } = await admin.rpc("record_system_audit", {
      p_action: params.action,
      p_subject_table: params.subjectTable,
      p_subject_id: params.subjectId,
      p_before: params.before ?? null,
      p_after: params.after ?? null,
    });
    if (error) {
      // Most likely the function is missing in 0009 or the parameter
      // names differ. Fall back to the user-scoped audit helper so we at
      // least get a row in `audit_log`, then log for operator attention.
      console.warn(
        `[audit] system RPC missing, skipping: ${error.message}`,
      );
      await recordAuditEvent({
        action: params.action,
        subjectTable: params.subjectTable,
        subjectId: params.subjectId,
        before: params.before,
        after: params.after,
      }).catch(() => {
        // swallow - the primary mutation already succeeded / failed
      });
    }
  } catch (err) {
    console.warn(
      `[audit] system RPC missing, skipping: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function promoteQuarantinedDocument(
  documentId: string,
  options?: PromoteOptions,
): Promise<PromoteResult> {
  // C-2 structural gate: without an explicit 'clean' verdict from the
  // scanner we refuse to promote. This is the only place status can
  // flip to 'available' for a quarantined row, so every caller that
  // grows a legitimate promote path must first land a scanner verdict.
  if (!options || options.scanVerdict !== "clean") {
    await recordSystemAudit({
      action: "document.promote.blocked",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { reason: "missing_scan_verdict" },
    });
    return {
      status: "noop",
      reason: "promote requires scanVerdict: 'clean' (scanner not wired up)",
    };
  }

  const admin = createAdminClient();

  const { data: doc, error: loadError } = await admin
    .from("documents")
    .select("id, uploaded_by, provider_id, storage_bucket, storage_path, status")
    .eq("id", documentId)
    .maybeSingle();

  if (loadError) {
    await recordSystemAudit({
      action: "document.promote.error",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { stage: "load", error: loadError.message },
    });
    throw new Error(`promoteQuarantinedDocument: ${loadError.message}`);
  }
  if (!doc) {
    await recordSystemAudit({
      action: "document.promote.noop",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { reason: "document not found" },
    });
    return { status: "noop", reason: "document not found" };
  }
  if (doc.status !== "quarantined") {
    await recordSystemAudit({
      action: "document.promote.noop",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { reason: `document status is ${doc.status}` },
    });
    return { status: "noop", reason: `document status is ${doc.status}` };
  }
  if (doc.storage_bucket !== PROVIDER_DOCS_BUCKET) {
    await recordSystemAudit({
      action: "document.promote.noop",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { reason: `unexpected bucket ${doc.storage_bucket}` },
    });
    return {
      status: "noop",
      reason: `unexpected bucket ${doc.storage_bucket}`,
    };
  }

  const currentPath = doc.storage_path as string;
  if (!currentPath.startsWith("quarantine/")) {
    await recordSystemAudit({
      action: "document.promote.noop",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { reason: `storage_path not in quarantine/: ${currentPath}` },
    });
    return {
      status: "noop",
      reason: `storage_path not in quarantine/: ${currentPath}`,
    };
  }
  const cleanPath = `clean/${currentPath.slice("quarantine/".length)}`;

  const move = await admin.storage
    .from(PROVIDER_DOCS_BUCKET)
    .move(currentPath, cleanPath);
  if (move.error) {
    await recordSystemAudit({
      action: "document.promote.error",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { stage: "move", error: move.error.message },
    });
    throw new Error(
      `promoteQuarantinedDocument: move failed: ${move.error.message}`,
    );
  }

  const { error: updateError } = await admin
    .from("documents")
    .update({ status: "available", storage_path: cleanPath })
    .eq("id", documentId);

  if (updateError) {
    // H-5: rollback hardening. If the row update fails, try to move the
    // object back to quarantine. Write an audit event for both the
    // failure and the rollback attempt so operators can reconcile from
    // the audit log, not from hand-inspecting storage.
    const rollback = await admin.storage
      .from(PROVIDER_DOCS_BUCKET)
      .move(cleanPath, currentPath);
    const rollbackOk = !rollback.error;

    await recordSystemAudit({
      action: "document.promote.rollback",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: {
        stage: "update",
        update_error: updateError.message,
        rollback_ok: rollbackOk,
        rollback_error: rollback.error?.message ?? null,
        expected_path: currentPath,
        moved_to: cleanPath,
      },
    });

    // Structured error so the caller knows whether the row and the
    // object are still in sync.
    const err: Error & {
      code?: string;
      documentId?: string;
      rollbackOk?: boolean;
    } = new Error(
      `promoteQuarantinedDocument: row update failed: ${updateError.message}` +
        (rollbackOk ? "" : ` (rollback also failed: ${rollback.error?.message})`),
    );
    err.code = rollbackOk
      ? "promote_update_failed"
      : "promote_update_and_rollback_failed";
    err.documentId = documentId;
    err.rollbackOk = rollbackOk;
    throw err;
  }

  await recordSystemAudit({
    action: "document.promote",
    subjectTable: "public.documents",
    subjectId: documentId,
    after: {
      status: "available",
      storage_path: cleanPath,
      scan_ref: options.scanRef ?? null,
    },
  });

  return { status: "available" };
}

/**
 * Dev / admin-tooling helper for C5. Flips a quarantined document to
 * `rejected` with a reason. NOT a Server Action; callers must authorize.
 */
export async function __forceRejectDocument(
  documentId: string,
  reason: string,
): Promise<PromoteResult> {
  if (!reason) {
    throw new Error("__forceRejectDocument: reason is required");
  }

  const admin = createAdminClient();

  const { data: doc, error: loadError } = await admin
    .from("documents")
    .select("id, status")
    .eq("id", documentId)
    .maybeSingle();

  if (loadError) {
    await recordSystemAudit({
      action: "document.reject.error",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { stage: "load", error: loadError.message },
    });
    throw new Error(`__forceRejectDocument: ${loadError.message}`);
  }
  if (!doc) {
    await recordSystemAudit({
      action: "document.reject.noop",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { reason: "document not found" },
    });
    return { status: "noop", reason: "document not found" };
  }
  if (doc.status !== "quarantined") {
    await recordSystemAudit({
      action: "document.reject.noop",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { reason: `document status is ${doc.status}` },
    });
    return { status: "noop", reason: `document status is ${doc.status}` };
  }

  const { error: updateError } = await admin
    .from("documents")
    .update({ status: "rejected", rejected_reason: reason })
    .eq("id", documentId);

  if (updateError) {
    await recordSystemAudit({
      action: "document.reject.error",
      subjectTable: "public.documents",
      subjectId: documentId,
      after: { stage: "update", error: updateError.message },
    });
    throw new Error(
      `__forceRejectDocument: update failed: ${updateError.message}`,
    );
  }

  await recordSystemAudit({
    action: "document.reject",
    subjectTable: "public.documents",
    subjectId: documentId,
    after: { status: "rejected", rejected_reason: reason },
  });

  return { status: "rejected", reason };
}

/**
 * H-5: reconciliation helper. Scans `documents` for rows whose object
 * does not exist at the expected path. Returns a structured list the
 * operator can review; no cron wiring is attached here - this is just
 * the function body so a later component (or a one-off admin tool) can
 * invoke it. Uses the admin client because it must see all rows
 * regardless of RLS.
 */
export type QuarantineReconcileEntry = {
  documentId: string;
  expectedBucket: string;
  expectedPath: string;
  status: string;
  issue: "object_missing" | "load_error";
  detail?: string;
};

export async function reconcileQuarantinedDocuments(
  limit = 200,
): Promise<QuarantineReconcileEntry[]> {
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("documents")
    .select("id, status, storage_bucket, storage_path")
    .in("status", ["quarantined", "available"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`reconcileQuarantinedDocuments: ${error.message}`);
  }

  const entries: QuarantineReconcileEntry[] = [];
  for (const row of (rows ?? []) as Array<{
    id: string;
    status: string;
    storage_bucket: string;
    storage_path: string;
  }>) {
    if (row.storage_bucket !== PROVIDER_DOCS_BUCKET) {
      continue;
    }
    const lastSlash = row.storage_path.lastIndexOf("/");
    const dir = lastSlash === -1 ? "" : row.storage_path.slice(0, lastSlash);
    const base = lastSlash === -1 ? row.storage_path : row.storage_path.slice(lastSlash + 1);

    const list = await admin.storage
      .from(PROVIDER_DOCS_BUCKET)
      .list(dir, { limit: 1, search: base });

    if (list.error) {
      entries.push({
        documentId: row.id,
        expectedBucket: row.storage_bucket,
        expectedPath: row.storage_path,
        status: row.status,
        issue: "load_error",
        detail: list.error.message,
      });
      continue;
    }

    const found = (list.data ?? []).some((entry) => entry.name === base);
    if (!found) {
      entries.push({
        documentId: row.id,
        expectedBucket: row.storage_bucket,
        expectedPath: row.storage_path,
        status: row.status,
        issue: "object_missing",
      });
    }
  }

  return entries;
}
