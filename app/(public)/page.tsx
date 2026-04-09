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
      <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <div data-theme="blue">
          <Link href="/receiver" className={buttonStyles()}>
            I need care
          </Link>
        </div>
        <div data-theme="purple">
          <Link href="/provider" className={buttonStyles()}>
            I provide care
          </Link>
        </div>
      </div>
    </section>
  );
}
