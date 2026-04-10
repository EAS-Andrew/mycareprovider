import type { Metadata } from "next";
import Link from "next/link";
import { AudienceBanner } from "@/components/ui/audience-banner";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = {
  title: "Administrator",
  icons: { icon: "/brand/favicon-admin.svg" },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-theme="admin" className="min-h-dvh bg-canvas text-ink">
      <AudienceBanner audience="admin" />
      <header className="flex items-center justify-between px-6 py-4">
        <Link
          href="/admin"
          className="flex items-center gap-3 font-semibold"
          aria-label="MyCareProvider, administrator home"
        >
          <BrandMark variant="admin" size={32} />
          <span className="font-heading text-lg font-bold">MyCareProvider</span>
        </Link>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
