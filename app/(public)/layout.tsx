import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = {
  title: "MyCareProvider",
  icons: { icon: "/brand/favicon-unified.svg" },
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/sign-in" className="hover:underline">
            Sign in
          </Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
