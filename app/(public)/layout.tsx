import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { createServerClient } from "@/lib/supabase/server";

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
          <span>MyCareProvider</span>
        </Link>
        <nav
          className="flex items-center gap-4 text-sm"
          aria-label="Account"
        >
          {user ? (
            <>
              <span className="text-ink-muted" aria-live="polite">
                Signed in as{" "}
                <span className="font-medium text-ink">{displayName}</span>
              </span>
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/auth/sign-in" className="hover:underline">
                Sign in
              </Link>
              <Link href="/auth/sign-up" className="hover:underline">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
