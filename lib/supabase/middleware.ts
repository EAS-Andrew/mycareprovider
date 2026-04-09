import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and propagates the
 * rotated cookies onto the outgoing NextResponse. The returned object gives
 * callers both the response (to return or mutate further) and the refreshed
 * user so route gating can read the `app_role` JWT claim without a second
 * network round-trip.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Pass `options` on BOTH the request- and response-side set calls
          // (finding auth#10). Omitting options from the request-side set
          // caused cookies to round-trip with default attributes on the
          // inbound request, which in turn let `getUser()` see a stale
          // session under certain cookie flag combinations.
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set({ name, value, ...options });
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() must be called to trigger cookie refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, supabase, user };
}
