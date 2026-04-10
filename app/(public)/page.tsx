import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Find care you can trust.
      </h1>
      <p className="mt-4 text-lg text-ink-muted">
        MyCareProvider helps families in the UK find vetted care providers,
        and helps care providers reach the people who need them.
      </p>
      <div className="mt-10 flex flex-col items-center gap-6">
        <Link
          href="/providers"
          className="inline-flex h-12 items-center justify-center rounded-md bg-ink px-6 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          Find a care provider
        </Link>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <div data-theme="blue">
            <Link href="/auth/sign-up" className={buttonStyles()}>
              I need care
            </Link>
          </div>
          <div data-theme="blue">
            <Link href="/auth/sign-up" className={buttonStyles({ variant: "outline" })}>
              I&apos;m helping a loved one
            </Link>
          </div>
          <div data-theme="purple">
            <Link href="/auth/provider-sign-up" className={buttonStyles()}>
              I provide care
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
