import { createServerClient as createSSRServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Canonical Supabase client for Server Components and Server Actions.
 * Reads and writes the auth cookies on the current request so the session
 * refreshed by `middleware.ts` is visible here.
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `set` throws from Server Components; safe to ignore when a
            // middleware layer is refreshing the session in parallel.
          }
        },
      },
    },
  );
}
