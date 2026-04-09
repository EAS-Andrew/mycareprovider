import "server-only";

import { getCurrentRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
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
 * trigger on `public.audit_log`; do not compute or pass it from TS.
 *
 * ## System events
 *
 * Background contexts (Vercel Cron, queue workers, tests) have no request
 * cookies, so `createServerClient()` would throw when called outside a
 * request. Pass `system: true` to route through the admin client and a
 * SECURITY DEFINER helper (`app.record_system_audit`, defined in migration
 * 0009 - sql-fixer's task). System events stamp `actor_id = null` and
 * `actor_role = null`.
 */
export async function recordAuditEvent(params: {
  action: string;
  subjectTable: string;
  subjectId?: string | null;
  before?: unknown;
  after?: unknown;
  system?: boolean;
}): Promise<void> {
  if (params.system) {
    const admin = createAdminClient();
    // TODO(migration 0009): `app.record_system_audit` is added by sql-fixer
    // in migration 0009. If the RPC is not yet deployed locally this call
    // will fail with PGRST202 - run the migration first.
    const { error } = await admin.rpc("record_system_audit", {
      p_action: params.action,
      p_subject_table: params.subjectTable,
      p_subject_id: params.subjectId ?? null,
      p_before: params.before ?? null,
      p_after: params.after ?? null,
    });
    if (error) {
      throw new Error(`recordAuditEvent(system): ${error.message}`);
    }
    return;
  }

  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Read actor_role from profiles.role via the user-scoped client. NEVER
  // from user_metadata (user-writable - finding auth#7). profiles_self_read
  // allows the user to read their own row.
  const actorRole = user ? await getCurrentRole(supabase, user) : null;

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
