import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { getCurrentRole, type AppRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";

const ROLE_DASHBOARD: Record<AppRole, { href: string; label: string }> = {
  admin: { href: "/admin", label: "Admin console" },
  provider: { href: "/provider", label: "Provider dashboard" },
  provider_company: { href: "/provider/company", label: "Company dashboard" },
  receiver: { href: "/receiver", label: "My dashboard" },
  family_member: { href: "/receiver", label: "My dashboard" },
};

export const metadata: Metadata = {
  title: "MyCareProvider",
  icons: { icon: "/brand/favicon-unified.svg" },
};

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const role = user ? await getCurrentRole(supabase, user) : null;
  const dashboard = role ? ROLE_DASHBOARD[role] : null;

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email ??
    null;

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-3 font-semibold"
          aria-label="MyCareProvider home"
        >
          <BrandMark variant="unified" size={32} />
          <span className="font-heading text-lg">MyCareProvider</span>
        </Link>
        <nav
          className="flex items-center gap-4 text-sm"
          aria-label="Primary"
        >
          <Link href="/providers" className="hover:underline">
            Browse providers
          </Link>
          {user ? (
            <>
              {dashboard ? (
                <Link
                  href={dashboard.href}
                  className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  {dashboard.label}
                </Link>
              ) : null}
              <span className="text-ink-muted" aria-live="polite">
                {displayName}
              </span>
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-ink-muted hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/auth/sign-in"
                className="text-ink-muted hover:text-ink hover:underline"
              >
                Sign in
              </Link>
              <Link
                href="/auth/sign-up"
                className="rounded-md bg-ink px-3 py-1.5 font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
