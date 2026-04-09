import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Privileged Supabase client that uses the service-role key. Bypasses RLS,
 * so every caller MUST perform its own authorization check before reaching
 * for this. Guarded with `server-only` so importing it from a Client
 * Component is a build-time error.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
