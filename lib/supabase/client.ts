import { createBrowserClient as createSSRBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. Use sparingly - server-first is
 * the default for this app. Reach for this only when a component genuinely
 * needs realtime subscriptions or optimistic writes from the browser.
 */
export function createBrowserClient() {
  return createSSRBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
