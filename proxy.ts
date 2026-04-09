import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

type AppRole =
  | "admin"
  | "provider"
  | "provider_company"
  | "receiver"
  | "family_member";

const ROLE_RULES: Array<{ prefix: string; allowed: ReadonlySet<AppRole> }> = [
  { prefix: "/admin", allowed: new Set<AppRole>(["admin"]) },
  {
    prefix: "/provider",
    allowed: new Set<AppRole>(["provider", "provider_company"]),
  },
  {
    prefix: "/receiver",
    allowed: new Set<AppRole>(["receiver", "family_member"]),
  },
];

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const rule = ROLE_RULES.find((r) => pathname.startsWith(r.prefix));
  if (!rule) {
    return response;
  }

  // Anonymous users hitting a gated route: bounce to sign-in with a ?next.
  if (!user) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/auth/sign-in";
    signIn.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(signIn);
  }

  // Prefer the JWT claim set by the Custom Access Token hook. Fall back to
  // app_metadata / user_metadata if the hook is misconfigured so a valid
  // admin session doesn't silently lose access.
  let role: string | null =
    (user.app_metadata?.app_role as string | undefined) ??
    (user.user_metadata?.role as string | undefined) ??
    null;

  if (!role) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token) {
      const claims = decodeJwtClaims(token);
      role = (claims?.app_role as string | undefined) ?? null;
    }
  }

  if (!role || !rule.allowed.has(role as AppRole)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/auth/sign-in";
    signIn.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  // Exclude static assets, _next internals, and the favicon set.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\..*).*)"],
};
