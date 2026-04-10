import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="overflow-hidden">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="warm-canvas grain relative isolate pb-24 pt-20 sm:pt-32">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="animate-fade-in text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            A UK care marketplace
          </p>
          <h1
            className="animate-fade-in-up mt-6 font-heading text-[2.75rem] leading-[1.1] tracking-tight text-ink sm:text-6xl lg:text-7xl"
            style={{ animationDelay: "100ms" }}
          >
            Care that fits <em className="not-italic text-blue-600">your</em>{" "}
            life, not the other way round.
          </h1>
          <p
            className="animate-fade-in-up mx-auto mt-8 max-w-xl text-lg leading-relaxed text-ink-muted sm:text-xl"
            style={{ animationDelay: "250ms" }}
          >
            MyCareProvider connects families across the UK with vetted,
            qualified care providers. Search by location, read real
            qualifications, and arrange care on your terms.
          </p>
          <div
            className="animate-fade-in-up mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
            style={{ animationDelay: "400ms" }}
          >
            <Link
              href="/providers"
              className="inline-flex h-13 items-center justify-center rounded-full bg-blue-600 px-10 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
            >
              Find a care provider
            </Link>
            <Link
              href="/auth/provider-sign-up"
              className="inline-flex h-13 items-center justify-center rounded-full border-2 border-purple-600 px-10 text-base font-semibold text-purple-700 transition-all hover:bg-purple-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2"
            >
              Join as a provider
            </Link>
          </div>
        </div>

        {/* Decorative blurs */}
        <div
          className="pointer-events-none absolute -left-32 -top-20 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
          style={{ background: "oklch(0.75 0.12 235)" }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-24 -right-20 h-[22rem] w-[22rem] rounded-full opacity-15 blur-3xl"
          style={{ background: "oklch(0.72 0.14 300)" }}
          aria-hidden="true"
        />
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="relative border-t border-border bg-canvas py-24">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-center text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Simple by design
          </p>
          <h2 className="mt-3 text-center font-heading text-3xl tracking-tight text-ink sm:text-4xl">
            Three steps to the right care
          </h2>

          <div className="stagger-children mt-16 grid gap-12 sm:grid-cols-3 sm:gap-8">
            {/* Step 1 */}
            <div className="relative text-center">
              <span className="font-heading text-6xl text-blue-600/20">1</span>
              <h3 className="-mt-2 text-lg font-semibold text-ink">
                Search by location
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                Enter your postcode and browse verified care providers near you.
                Filter by services, qualifications, and rates.
              </p>
            </div>

            {/* Step 2 */}
            <div className="relative text-center">
              <span className="font-heading text-6xl text-blue-600/20">2</span>
              <h3 className="-mt-2 text-lg font-semibold text-ink">
                Connect directly
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                Send a contact request to providers who look right. Discuss your
                needs through secure messaging and arrange a meeting.
              </p>
            </div>

            {/* Step 3 */}
            <div className="relative text-center">
              <span className="font-heading text-6xl text-blue-600/20">3</span>
              <h3 className="-mt-2 text-lg font-semibold text-ink">
                Agree a care plan
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                Your provider creates a transparent plan with clear pricing.
                Approve it, and manage everything in one place.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Audience cards ────────────────────────────────────── */}
      <section className="border-t border-border bg-surface py-24">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-center text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            For everyone involved
          </p>
          <h2 className="mt-3 text-center font-heading text-3xl tracking-tight text-ink sm:text-4xl">
            Built around the people who give and receive care
          </h2>

          <div className="stagger-children mt-14 grid gap-6 sm:grid-cols-3">
            {/* Receivers */}
            <div className="group relative rounded-2xl border border-blue-200 bg-white p-8 transition-shadow hover:shadow-lg hover:shadow-blue-600/5">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </div>
              <h3 className="mt-5 font-heading text-xl text-ink">
                I need care
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Browse providers in your area, check their qualifications, and
                arrange care that works for your schedule and budget.
              </p>
              <div className="mt-6" data-theme="blue">
                <Link href="/auth/sign-up" className={buttonStyles({ size: "sm" })}>
                  Create an account
                </Link>
              </div>
            </div>

            {/* Family */}
            <div className="group relative rounded-2xl border border-blue-200 bg-white p-8 transition-shadow hover:shadow-lg hover:shadow-blue-600/5">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              </div>
              <h3 className="mt-5 font-heading text-xl text-ink">
                I&apos;m helping a loved one
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Manage care on behalf of a family member. Join their care circle,
                review care plans, and stay informed.
              </p>
              <div className="mt-6" data-theme="blue">
                <Link href="/auth/sign-up" className={buttonStyles({ size: "sm" })}>
                  Get started
                </Link>
              </div>
            </div>

            {/* Providers */}
            <div className="group relative rounded-2xl border border-purple-200 bg-white p-8 transition-shadow hover:shadow-lg hover:shadow-purple-600/5">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
              </div>
              <h3 className="mt-5 font-heading text-xl text-ink">
                I provide care
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Reach families who need your skills. Create a verified profile,
                showcase your qualifications, and grow your practice.
              </p>
              <div className="mt-6" data-theme="purple">
                <Link href="/auth/provider-sign-up" className={buttonStyles({ size: "sm" })}>
                  Register as a provider
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust signals ─────────────────────────────────────── */}
      <section className="relative border-t border-border bg-canvas py-24">
        <div className="mx-auto max-w-4xl px-6">
          <p className="text-center text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Peace of mind
          </p>
          <h2 className="mt-3 text-center font-heading text-3xl tracking-tight text-ink sm:text-4xl">
            Safety and trust, built in
          </h2>

          <div className="stagger-children mt-14 grid gap-10 sm:grid-cols-2">
            <TrustItem
              title="Verified providers"
              description="Every provider submits identity documents, DBS checks, insurance, and certifications. Our team reviews them before any profile goes live."
              icon={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />}
              iconCheck={<path d="m9 12 2 2 4-4" />}
            />
            <TrustItem
              title="Secure messaging"
              description="All communication happens on-platform with end-to-end privacy. No phone numbers or emails are shared until you choose to."
              icon={<><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>}
            />
            <TrustItem
              title="Transparent care plans"
              description="Every care plan has line-by-line pricing. You approve it before any work begins, and every change is versioned."
              icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>}
            />
            <TrustItem
              title="Safeguarding built in"
              description="Anyone can raise a safeguarding concern at any time. Reports are triaged within 24 hours and escalated to statutory bodies when required."
              icon={<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>}
            />
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────── */}
      <section className="grain relative isolate border-t border-border py-28">
        {/* gradient background */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(170deg, oklch(0.96 0.03 235) 0%, oklch(0.97 0.02 280) 50%, oklch(0.96 0.03 300) 100%)",
          }}
          aria-hidden="true"
        />
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-heading text-3xl tracking-tight text-ink sm:text-4xl">
            Ready to get started?
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink-muted">
            Whether you need care, provide care, or are helping a loved one,
            MyCareProvider is free to join.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/providers"
              className="inline-flex h-13 items-center justify-center rounded-full bg-blue-600 px-10 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
            >
              Browse providers
            </Link>
            <Link
              href="/auth/sign-up"
              className="inline-flex h-13 items-center justify-center rounded-full border-2 border-ink bg-white/60 px-10 text-base font-semibold text-ink backdrop-blur-sm transition-all hover:bg-ink hover:text-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-canvas py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 text-center text-sm text-ink-muted sm:flex-row sm:justify-between sm:text-left">
          <p>&copy; {new Date().getFullYear()} MyCareProvider Ltd.</p>
          <nav className="flex gap-6" aria-label="Footer">
            <Link href="/providers" className="hover:text-ink hover:underline">
              Browse providers
            </Link>
            <Link href="/auth/sign-in" className="hover:text-ink hover:underline">
              Sign in
            </Link>
            <Link href="/auth/sign-up" className="hover:text-ink hover:underline">
              Get started
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ── Trust signal item ──────────────────────────────────────── */

function TrustItem({
  title,
  description,
  icon,
  iconCheck,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconCheck?: React.ReactNode;
}) {
  return (
    <div className="flex gap-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          {icon}
          {iconCheck}
        </svg>
      </div>
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {description}
        </p>
      </div>
    </div>
  );
}
