import type { Metadata } from "next";
import Link from "next/link";
import { AudienceBanner } from "@/components/ui/audience-banner";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = {
  title: "Care provider",
  icons: { icon: "/brand/favicon-purple.svg" },
};

export default function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-theme="purple" className="min-h-dvh bg-canvas text-ink">
      <AudienceBanner audience="provider" />
      <header className="flex items-center justify-between px-6 py-4">
        <Link
          href="/provider"
          className="flex items-center gap-3 font-semibold"
          aria-label="MyCareProvider, care provider home"
        >
          <BrandMark variant="provider" size={32} />
          <span>MyCareProvider</span>
        </Link>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
