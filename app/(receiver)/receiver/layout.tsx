import type { Metadata } from "next";
import Link from "next/link";
import { AudienceBanner } from "@/components/ui/audience-banner";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = {
  title: "Care receiver",
  icons: { icon: "/brand/favicon-blue.svg" },
};

export default function ReceiverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-theme="blue" className="min-h-dvh bg-canvas text-ink">
      <AudienceBanner audience="receiver" />
      <header className="flex items-center justify-between px-6 py-4">
        <Link
          href="/receiver"
          className="flex items-center gap-3 font-semibold"
          aria-label="MyCareProvider, care receiver home"
        >
          <BrandMark variant="receiver" size={32} />
          <span>MyCareProvider</span>
        </Link>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
