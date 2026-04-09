import { NextResponse, type NextRequest } from "next/server";

import { getCurrentRole, type AppRole } from "@/lib/auth/current-role";
import { updateSession } from "@/lib/supabase/middleware";

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

export async function proxy(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const rule = ROLE_RULES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
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

  // Single source of truth: profiles.role via the user-scoped client.
  // Do NOT read user.user_metadata.role (user-writable), do NOT read
  // user.app_metadata.app_role (never populated), do NOT decode the JWT.
  // See docs/bug-hunt/auth-findings.md #2 and #9 for why.
  const role = await getCurrentRole(supabase, user);

  if (!role || !rule.allowed.has(role)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/auth/sign-in";
    signIn.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  // Exclude only known static asset extensions (finding auth#5 - a path
  // pattern like `.*\\..*` let `/admin/users/export.csv` skip the proxy
  // entirely). Gated prefixes are also listed explicitly so they are
  // always evaluated regardless of extension.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|svg|gif|ico|css|js|map|txt|xml|webp|woff|woff2)).*)",
    "/admin/:path*",
    "/provider/:path*",
    "/receiver/:path*",
  ],
};
