import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="overflow-hidden">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative flex items-center px-4 sm:px-6">
        {/* Soft background blurs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute right-4 top-20 h-64 w-64 rounded-full bg-blue-100/40 blur-3xl sm:right-10 sm:h-96 sm:w-96" />
          <div className="absolute bottom-32 left-4 h-48 w-48 rounded-full bg-neutral-200/30 blur-2xl sm:left-16 sm:h-80 sm:w-80" />
          <div className="absolute right-1/3 top-1/2 h-32 w-32 rounded-full bg-neutral-200/20 blur-xl sm:h-64 sm:w-64" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-7xl">
          <div className="grid min-h-[80vh] items-center gap-8 lg:grid-cols-12 lg:gap-12">
            {/* Hero content */}
            <div className="space-y-12 lg:col-span-7 lg:space-y-16">
              <div className="space-y-8 lg:space-y-10">
                <div className="space-y-6 lg:space-y-8">
                  {/* Badge */}
                  <div className="inline-flex items-center gap-3 rounded-full border border-neutral-200/60 bg-white/90 px-6 py-3 shadow-lg backdrop-blur-sm lg:gap-4 lg:px-8 lg:py-4">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400 shadow-sm lg:h-3 lg:w-3" />
                    <span className="text-sm font-medium text-neutral-700 sm:text-base">
                      A UK care marketplace
                    </span>
                  </div>

                  <h1 className="font-heading text-3xl font-bold leading-[0.95] text-neutral-800 sm:text-4xl lg:text-5xl xl:text-6xl">
                    Care that fits
                    <span className="relative mt-1 block text-blue-500 lg:mt-2">
                      your life
                      <span className="absolute -bottom-2 left-0 h-1 w-20 rounded-full bg-blue-200 sm:w-24 lg:-bottom-4 lg:h-1.5 lg:w-32" />
                    </span>
                  </h1>

                  <p className="max-w-xl text-lg font-light leading-relaxed text-neutral-600 sm:text-xl">
                    When someone you love needs care, you want more than just
                    professional service. MyCareProvider connects UK families
                    with vetted, qualified care providers you can trust.
                  </p>
                </div>

                <div className="flex flex-col items-start gap-4 sm:flex-row lg:gap-6">
                  <Link
                    href="/providers"
                    className="group inline-flex w-full items-center justify-center rounded-3xl bg-blue-500 px-6 py-3 text-base font-medium text-white shadow-lg transition-all duration-300 hover:scale-105 hover:bg-blue-600 hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 sm:w-auto sm:px-8 sm:py-4 sm:text-lg"
                  >
                    Browse care providers
                    <svg className="ml-2 inline h-4 w-4 transition-transform group-hover:translate-x-1 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                  <Link
                    href="/auth/provider-sign-up"
                    className="inline-flex w-full items-center justify-center rounded-3xl border-2 border-neutral-300 bg-white/60 px-6 py-3 text-base font-medium text-neutral-700 shadow-lg backdrop-blur-sm transition-all duration-300 hover:border-neutral-400 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 sm:w-auto sm:px-8 sm:py-4 sm:text-lg"
                  >
                    Join as a provider
                  </Link>
                </div>
              </div>

              {/* Trust indicators */}
              <div className="grid grid-cols-3 gap-4 border-t-2 border-neutral-200 pt-12 sm:gap-8 lg:gap-12 lg:pt-16">
                <div className="space-y-1 text-center lg:space-y-2">
                  <div className="font-heading text-xl font-bold text-blue-600 sm:text-2xl lg:text-3xl">
                    DBS
                  </div>
                  <div className="text-xs font-medium text-neutral-600 sm:text-sm lg:text-base">
                    Checked Providers
                  </div>
                </div>
                <div className="space-y-1 text-center lg:space-y-2">
                  <div className="font-heading text-xl font-bold text-neutral-600 sm:text-2xl lg:text-3xl">
                    Verified
                  </div>
                  <div className="text-xs font-medium text-neutral-600 sm:text-sm lg:text-base">
                    Qualifications
                  </div>
                </div>
                <div className="space-y-1 text-center lg:space-y-2">
                  <div className="font-heading text-xl font-bold text-neutral-600 sm:text-2xl lg:text-3xl">
                    100%
                  </div>
                  <div className="text-xs font-medium text-neutral-600 sm:text-sm lg:text-base">
                    Transparent Pricing
                  </div>
                </div>
              </div>
            </div>

            {/* Hero visual - glass card */}
            <div className="relative mt-8 lg:col-span-5 lg:mt-0">
              <div className="relative">
                <div className="relative z-10 rounded-3xl border-2 border-white/40 bg-white/95 p-6 shadow-2xl backdrop-blur-lg sm:p-8 lg:p-10">
                  <div className="space-y-8">
                    {/* Provider preview */}
                    <div className="flex items-start gap-5">
                      <div className="relative">
                        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-100 text-3xl font-bold text-blue-600 shadow-lg">
                          ER
                        </div>
                        <div className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-blue-500 shadow-lg">
                          <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex-1">
                        <h4 className="text-xl font-semibold text-neutral-800">
                          Emma Richardson
                        </h4>
                        <p className="text-lg text-neutral-600">
                          Registered Nurse &middot; 12 years experience
                        </p>
                        <div className="mt-3 flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <svg key={i} className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            ))}
                          </div>
                          <span className="text-base font-medium text-neutral-700">
                            4.9 (127 families)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Services */}
                    <div className="space-y-4">
                      <div className="text-base font-medium text-neutral-800">
                        Specialisations:
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {["Dementia Care", "Daily Living", "Medication", "Companionship"].map((s) => (
                          <span key={s} className="rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-2 text-base text-neutral-700">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Availability */}
                    <div className="rounded-3xl border-2 border-neutral-100 bg-neutral-50 p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-base text-neutral-600">
                            Available to help today
                          </div>
                          <div className="text-2xl font-semibold text-neutral-800">
                            &pound;28/hour
                          </div>
                        </div>
                        <span className="rounded-2xl bg-neutral-800 px-8 py-3 text-base font-medium text-white shadow-lg">
                          View profile
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating soft elements */}
                <div className="absolute -left-8 -top-8 h-32 w-32 rounded-full bg-neutral-200/40 blur-xl" />
                <div className="absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-blue-200/30 blur-2xl" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────── */}
      <section className="bg-white px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-24 text-center">
            <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-blue-200 bg-blue-100 px-6 py-3">
              <div className="h-3 w-3 rounded-full bg-blue-500" />
              <span className="text-base font-medium text-blue-700">
                What makes us different
              </span>
            </div>
            <h2 className="mb-6 font-heading text-4xl font-bold text-neutral-800 lg:text-5xl">
              Care built on
              <span className="block text-blue-500">trust and transparency</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-10">
            {/* Large feature card */}
            <div className="relative overflow-hidden rounded-3xl bg-blue-500 p-10 text-white shadow-2xl lg:col-span-2 lg:p-16">
              <div className="relative z-10">
                <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/20">
                  <svg className="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="mb-6 font-heading text-3xl font-bold lg:text-4xl">
                  Verified Providers
                </h3>
                <p className="text-xl leading-relaxed text-blue-100">
                  Every provider submits identity documents, DBS checks,
                  insurance, and certifications. Our team reviews them before
                  any profile goes live, so you only see people you can trust.
                </p>
              </div>
              <div className="absolute right-10 top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            </div>

            {/* Matching card */}
            <div className="relative overflow-hidden rounded-3xl border-2 border-neutral-100 bg-white p-10 shadow-xl">
              <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
                <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="mb-4 font-heading text-2xl font-bold text-neutral-800">
                Direct Connections
              </h3>
              <p className="text-lg leading-relaxed text-neutral-600">
                Send a contact request to providers who look right. Discuss
                your needs through secure messaging and arrange an initial
                meeting on your terms.
              </p>
            </div>

            {/* Communication card */}
            <div className="relative overflow-hidden rounded-3xl border-2 border-neutral-100 bg-neutral-50 p-10">
              <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-neutral-200 bg-white shadow-lg">
                <svg className="h-8 w-8 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="mb-4 font-heading text-2xl font-bold text-neutral-800">
                Secure Messaging
              </h3>
              <p className="text-lg leading-relaxed text-neutral-600">
                All communication happens on-platform with complete privacy.
                No phone numbers or emails are shared until you choose to.
              </p>
            </div>

            {/* Transparent pricing card */}
            <div className="relative rounded-3xl border-2 border-neutral-100 bg-white p-10 shadow-xl lg:col-span-2">
              <div className="flex items-start gap-8">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-100">
                  <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="mb-4 font-heading text-2xl font-bold text-neutral-800">
                    Transparent Care Plans
                  </h3>
                  <p className="text-lg leading-relaxed text-neutral-600">
                    Every care plan has line-by-line pricing. You approve it
                    before any work begins, and every change is versioned so
                    nothing is hidden. No surprises, no confusing bills.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How we help ───────────────────────────────────────── */}
      <section className="bg-neutral-50 px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-20 text-center">
            <h2 className="mb-6 font-heading text-4xl font-bold text-neutral-800 lg:text-5xl">
              Built for everyone
              <span className="block text-blue-500">involved in care</span>
            </h2>
            <p className="mx-auto max-w-2xl text-xl leading-relaxed text-neutral-600">
              Whether you need care, provide care, or are helping arrange it
              for a loved one, the platform works for you.
            </p>
          </div>

          <div className="mx-auto grid max-w-6xl gap-16 lg:grid-cols-2">
            {/* Family side */}
            <div className="space-y-12">
              <div className="rounded-3xl border-2 border-neutral-100 bg-white p-10 shadow-xl">
                <div className="mb-8 flex items-start gap-6">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-100">
                    <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="mb-3 font-heading text-2xl font-bold text-neutral-800">
                      For Families
                    </h3>
                    <p className="text-lg leading-relaxed text-neutral-600">
                      Browse providers in your area, check their qualifications
                      and experience, and arrange care that works for your
                      schedule and budget.
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  {[
                    "Search verified providers by postcode",
                    "Review qualifications, experience, and rates",
                    "Arrange care on your terms",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500">
                        <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span className="font-medium text-neutral-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border-2 border-blue-100 bg-blue-50 p-8 text-center">
                <Link
                  href="/auth/sign-up"
                  className="inline-flex items-center justify-center rounded-3xl bg-blue-500 px-12 py-4 text-xl font-semibold text-white shadow-xl transition-all duration-300 hover:scale-105 hover:bg-blue-600"
                >
                  Find a care provider
                </Link>
              </div>
            </div>

            {/* Provider side */}
            <div className="space-y-12">
              <div className="rounded-3xl border-2 border-neutral-100 bg-white p-10 shadow-xl">
                <div className="mb-8 flex items-start gap-6">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-purple-100">
                    <svg className="h-8 w-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="mb-3 font-heading text-2xl font-bold text-neutral-800">
                      For Care Providers
                    </h3>
                    <p className="text-lg leading-relaxed text-neutral-600">
                      Reach families who need your skills. Create a verified
                      profile, showcase your qualifications, and grow your
                      practice.
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  {[
                    "Build a verified professional profile",
                    "Connect with families who need your skills",
                    "Manage your schedule and care plans",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-500">
                        <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span className="font-medium text-neutral-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border-2 border-purple-100 bg-purple-50 p-8 text-center">
                <Link
                  href="/auth/provider-sign-up"
                  className="inline-flex items-center justify-center rounded-3xl bg-purple-600 px-12 py-4 text-xl font-semibold text-white shadow-xl transition-all duration-300 hover:scale-105 hover:bg-purple-700"
                >
                  Register as a provider
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Safeguarding ──────────────────────────────────────── */}
      <section className="bg-white px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-3xl border-2 border-neutral-100 bg-white p-12 shadow-xl lg:p-16">
            <h3 className="mb-6 font-heading text-3xl font-bold text-neutral-800">
              Safeguarding built in
            </h3>
            <p className="mb-8 max-w-2xl text-xl leading-relaxed text-neutral-600">
              Anyone can raise a safeguarding concern at any time. Reports
              are triaged within 24 hours and escalated to statutory bodies
              when required. Your safety is never an afterthought.
            </p>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-5 w-5 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                  </svg>
                </div>
                <span className="font-medium text-neutral-700">DBS checked</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-5 w-5 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="font-medium text-neutral-700">Identity verified</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-5 w-5 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="font-medium text-neutral-700">24hr triage</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-blue-500 px-4 py-16 text-white sm:px-6 sm:py-20 lg:py-24">
        {/* Soft background elements */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-20 top-20 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-20 right-20 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto max-w-5xl text-center">
          <div className="space-y-12">
            <div className="space-y-8">
              <h2 className="font-heading text-4xl font-bold leading-tight lg:text-5xl">
                Ready to get started?
              </h2>
              <p className="mx-auto max-w-2xl text-xl leading-relaxed text-blue-100">
                Whether you need care, provide care, or are helping a loved
                one, MyCareProvider is free to join.
              </p>
            </div>

            <div className="flex flex-col items-center justify-center gap-8 sm:flex-row">
              <Link
                href="/providers"
                className="group inline-flex items-center rounded-3xl bg-white px-12 py-5 text-xl font-semibold text-blue-600 shadow-2xl transition-all duration-300 hover:scale-105 hover:bg-neutral-100"
              >
                Browse providers
                <svg className="ml-3 inline h-6 w-6 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <Link
                href="/auth/sign-up"
                className="inline-flex items-center rounded-3xl border-[3px] border-blue-300 px-12 py-5 text-xl font-semibold text-blue-100 transition-all duration-300 hover:border-white hover:text-white"
              >
                Create an account
              </Link>
            </div>

            <div className="border-t-2 border-blue-400 pt-16">
              <p className="text-lg text-blue-200">
                No setup fees &middot; Verified providers &middot; Free to join
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="border-t-2 border-neutral-200 bg-white px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 grid gap-12 md:grid-cols-4">
            {/* Brand */}
            <div>
              <div className="mb-6 flex items-center gap-3">
                <span className="font-heading text-2xl font-semibold text-neutral-800">
                  MyCareProvider
                </span>
              </div>
              <p className="text-lg leading-relaxed text-neutral-600">
                Connecting families with verified care providers across the UK.
              </p>
            </div>

            {/* For families */}
            <div>
              <h3 className="mb-6 text-xl font-semibold text-blue-500">
                For Families
              </h3>
              <ul className="space-y-4 text-lg text-neutral-600">
                <li>
                  <Link href="/providers" className="transition-colors hover:text-blue-500">
                    Find a Provider
                  </Link>
                </li>
                <li>
                  <Link href="/auth/sign-up" className="transition-colors hover:text-blue-500">
                    Create Account
                  </Link>
                </li>
              </ul>
            </div>

            {/* For providers */}
            <div>
              <h3 className="mb-6 text-xl font-semibold text-purple-600">
                For Providers
              </h3>
              <ul className="space-y-4 text-lg text-neutral-600">
                <li>
                  <Link href="/auth/provider-sign-up" className="transition-colors hover:text-purple-600">
                    Register as a Provider
                  </Link>
                </li>
                <li>
                  <Link href="/auth/sign-in" className="transition-colors hover:text-purple-600">
                    Provider Sign In
                  </Link>
                </li>
              </ul>
            </div>

            {/* Support */}
            <div>
              <h3 className="mb-6 text-xl font-semibold text-neutral-800">
                Support
              </h3>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-100 p-4">
                <p className="font-medium text-neutral-700">
                  Help available 24/7
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  hello@mycareprovider.com
                </p>
              </div>
            </div>
          </div>

          <div className="border-t-2 border-neutral-200 pt-12">
            <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
              <p className="text-lg text-neutral-600">
                &copy; {new Date().getFullYear()} MyCareProvider Ltd.
              </p>
              <div className="flex flex-wrap justify-center gap-8 md:justify-end">
                <Link href="/providers" className="text-lg text-neutral-600 transition-colors hover:text-blue-500">
                  Browse Providers
                </Link>
                <Link href="/auth/sign-in" className="text-lg text-neutral-600 transition-colors hover:text-neutral-800">
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
