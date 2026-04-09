import "server-only";

import { createServerClient } from "@/lib/supabase/server";

/**
 * W2 audit-log helper (see `docs/pid.md` - workstream W2, "Audit logging").
 *
 * Every component that mutates a regulated entity MUST call this from its
 * Server Action or route handler. Downstream consumers today or in the near
 * future: C3 (onboarding), C5 (verification console), C10 (care plans),
 * C11 (visit records), C13 (payments), C24 (DSAR/erasure).
 *
 * Hash chaining (`prev_hash`, `row_hash`) is computed by the BEFORE INSERT
 * trigger on `public.audit_log`; do not compute or pass it from TS. Inserts
 * from unauthenticated callers are allowed with `actor_id = null` for system
 * events only - prefer to wrap system actions in an admin session.
 */
export async function recordAuditEvent(params: {
  action: string;
  subjectTable: string;
  subjectId?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const actorRole =
    (user?.app_metadata?.app_role as string | undefined) ??
    (user?.user_metadata?.role as string | undefined) ??
    null;

  const { error } = await supabase.from("audit_log").insert({
    actor_id: user?.id ?? null,
    actor_role: actorRole,
    action: params.action,
    subject_table: params.subjectTable,
    subject_id: params.subjectId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
  });

  if (error) {
    throw new Error(`recordAuditEvent: ${error.message}`);
  }
}
