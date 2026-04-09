import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createServerClient } from "@/lib/supabase/server";

export type AppRole =
  | "admin"
  | "provider"
  | "provider_company"
  | "receiver"
  | "family_member";

const APP_ROLES: ReadonlySet<string> = new Set<AppRole>([
  "admin",
  "provider",
  "provider_company",
  "receiver",
  "family_member",
]);

/**
 * Single source of truth for the caller's role in TypeScript land.
 *
 * Reads `profiles.role` for the authenticated user through the user-scoped
 * client. The `profiles_self_read` RLS policy guarantees a user can read
 * their own row. NEVER fall back to `user.user_metadata.role` - it is
 * user-writable and was the root of a trivial privilege-escalation bug.
 * `user.app_metadata.app_role` is also NOT populated by this codebase
 * (the custom access token hook only injects the claim; it does not
 * write into raw_app_meta_data), so that path is unreliable too.
 *
 * Returns null when there is no session, or when the profile row is
 * missing / unreadable. Callers must fail closed on null.
 */
export async function getCurrentRole(
  client?: SupabaseClient,
  user?: User | null,
): Promise<AppRole | null> {
  const supabase = client ?? (await createServerClient());

  let authedUser = user ?? null;
  if (authedUser === undefined || authedUser === null) {
    const {
      data: { user: fetched },
    } = await supabase.auth.getUser();
    authedUser = fetched;
  }

  if (!authedUser) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authedUser.id)
    .maybeSingle();

  if (error || !data || typeof data.role !== "string") {
    return null;
  }

  return APP_ROLES.has(data.role) ? (data.role as AppRole) : null;
}
