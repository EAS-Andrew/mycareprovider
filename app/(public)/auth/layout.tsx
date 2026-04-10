import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-73px)] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Link
            href="/"
            aria-label="MyCareProvider home"
            className="flex items-center gap-3"
          >
            <BrandMark variant="unified" size={48} />
          </Link>
          <span className="text-sm text-ink-muted">MyCareProvider</span>
        </div>
        <div className="rounded-2xl border-2 border-border bg-surface p-8 shadow-lg">
          {children}
        </div>
      </div>
    </div>
  );
}
