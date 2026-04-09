import Link from "next/link";
import { Input } from "@/components/ui/input";
import { getOwnProviderProfile } from "@/lib/providers/actions";
import { getOwnProviderProfileWithCatalog } from "@/lib/providers/catalog";
import { submitProviderProfile } from "./actions";

export const metadata = {
  title: "Your provider profile - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    welcome?: string;
  }>;
};

function penceToPoundsString(pence: number | null): string {
  if (pence === null) return "";
  // Two-decimal fixed; the input accepts step=0.01.
  return (pence / 100).toFixed(2);
}

export default async function ProviderOnboardingPage({
  searchParams,
}: PageProps) {
  const { error, saved, welcome } = await searchParams;
  const [profile, catalog] = await Promise.all([
    getOwnProviderProfile(),
    getOwnProviderProfileWithCatalog(),
  ]);

  const serviceCount = catalog?.serviceCategoryIds.length ?? 0;
  const capabilityCount = catalog?.capabilityIds.length ?? 0;
  const certificationCount = catalog?.certifications.length ?? 0;

  const catalogSections: Array<{
    id: string;
    title: string;
    href: string;
    hrefLabel: string;
    detail: string;
  }> = [
    {
      id: "services",
      title: "Services you offer",
      href: "/provider/onboarding/services",
      hrefLabel: serviceCount > 0 ? "Edit services" : "Choose services",
      detail:
        serviceCount === 0
          ? "No services selected yet."
          : `${serviceCount} ${serviceCount === 1 ? "service" : "services"} selected.`,
    },
    {
      id: "capabilities",
      title: "Capabilities",
      href: "/provider/onboarding/capabilities",
      hrefLabel: capabilityCount > 0 ? "Edit capabilities" : "Choose capabilities",
      detail:
        capabilityCount === 0
          ? "No capabilities selected yet."
          : `${capabilityCount} ${capabilityCount === 1 ? "capability" : "capabilities"} selected.`,
    },
    {
      id: "certifications",
      title: "Certifications",
      href: "/provider/onboarding/certifications",
      hrefLabel:
        certificationCount > 0 ? "Manage certifications" : "Add certifications",
      detail:
        certificationCount === 0
          ? "No certifications added yet."
          : `${certificationCount} certification${certificationCount === 1 ? "" : "s"} on file.`,
    },
  ];

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Your provider profile
        </h1>
        <p className="text-ink-muted">
          Plain, accurate information helps care receivers decide whether you
          are the right fit. You can edit this at any time.
        </p>
      </header>

      {welcome ? (
        <div
          role="status"
          className="rounded-md border border-brand bg-surface p-3 text-sm text-ink"
        >
          Your account is created. Fill in the details below to continue
          onboarding.
        </div>
      ) : null}

      {saved ? (
        <div
          role="status"
          className="rounded-md border border-success bg-surface p-3 text-sm text-ink"
        >
          Profile saved.
        </div>
      ) : null}

      {error ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form
        action={submitProviderProfile}
        className="space-y-6 rounded-lg border border-border bg-surface p-6"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="headline"
            className="block text-sm font-medium text-ink"
          >
            Headline
          </label>
          <Input
            id="headline"
            name="headline"
            type="text"
            maxLength={120}
            defaultValue={profile?.headline ?? ""}
            aria-describedby={error ? "form-error" : "headline-hint"}
          />
          <p id="headline-hint" className="text-xs text-ink-muted">
            One line summary, for example &quot;Live-in carer, 12 years
            experience&quot;.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="bio" className="block text-sm font-medium text-ink">
            About you
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={5}
            defaultValue={profile?.bio ?? ""}
            aria-describedby={error ? "form-error" : "bio-hint"}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
          />
          <p id="bio-hint" className="text-xs text-ink-muted">
            A few sentences about who you are and the care you provide.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="date_of_birth"
              className="block text-sm font-medium text-ink"
            >
              Date of birth
            </label>
            <Input
              id="date_of_birth"
              name="date_of_birth"
              type="date"
              defaultValue={profile?.date_of_birth ?? ""}
              aria-describedby={error ? "form-error" : "dob-hint"}
            />
            <p id="dob-hint" className="text-xs text-ink-muted">
              Providers must be at least 18.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-ink"
            >
              Phone
            </label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={profile?.phone ?? ""}
              aria-describedby={error ? "form-error" : "phone-hint"}
            />
            <p id="phone-hint" className="text-xs text-ink-muted">
              Digits, spaces, parentheses, + or - only.
            </p>
          </div>
        </div>

        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-ink">Address</legend>

          <div className="space-y-2">
            <label
              htmlFor="address_line1"
              className="block text-sm font-medium text-ink"
            >
              Address line 1
            </label>
            <Input
              id="address_line1"
              name="address_line1"
              type="text"
              autoComplete="address-line1"
              defaultValue={profile?.address_line1 ?? ""}
              aria-describedby={error ? "form-error" : undefined}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="address_line2"
              className="block text-sm font-medium text-ink"
            >
              Address line 2
            </label>
            <Input
              id="address_line2"
              name="address_line2"
              type="text"
              autoComplete="address-line2"
              defaultValue={profile?.address_line2 ?? ""}
              aria-describedby={error ? "form-error" : undefined}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="city"
                className="block text-sm font-medium text-ink"
              >
                City
              </label>
              <Input
                id="city"
                name="city"
                type="text"
                autoComplete="address-level2"
                defaultValue={profile?.city ?? ""}
                aria-describedby={error ? "form-error" : undefined}
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="postcode"
                className="block text-sm font-medium text-ink"
              >
                Postcode
              </label>
              <Input
                id="postcode"
                name="postcode"
                type="text"
                autoComplete="postal-code"
                defaultValue={profile?.postcode ?? ""}
                aria-describedby={error ? "form-error" : undefined}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="country"
              className="block text-sm font-medium text-ink"
            >
              Country
            </label>
            <Input
              id="country"
              name="country"
              type="text"
              autoComplete="country"
              defaultValue={profile?.country ?? "GB"}
              aria-describedby={error ? "form-error" : "country-hint"}
            />
            <p id="country-hint" className="text-xs text-ink-muted">
              Two-letter country code, default GB.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="service_postcode"
                className="block text-sm font-medium text-ink"
              >
                Service postcode
              </label>
              <Input
                id="service_postcode"
                name="service_postcode"
                type="text"
                defaultValue={profile?.service_postcode ?? ""}
                aria-describedby={error ? "form-error" : "service-postcode-hint"}
              />
              <p
                id="service-postcode-hint"
                className="text-xs text-ink-muted"
              >
                UK postcode used for radius search. Defaults to your home
                postcode if left blank.
              </p>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="service_radius_km"
                className="block text-sm font-medium text-ink"
              >
                Service radius (km)
              </label>
              <Input
                id="service_radius_km"
                name="service_radius_km"
                type="number"
                min={0}
                max={200}
                step={1}
                inputMode="numeric"
                defaultValue={profile?.service_radius_km ?? 25}
                aria-describedby={error ? "form-error" : "service-radius-hint"}
              />
              <p id="service-radius-hint" className="text-xs text-ink-muted">
                How far from your service postcode you are willing to
                travel. 0 to 200 km.
              </p>
            </div>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="years_experience"
              className="block text-sm font-medium text-ink"
            >
              Years of experience
            </label>
            <Input
              id="years_experience"
              name="years_experience"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={profile?.years_experience ?? ""}
              aria-describedby={error ? "form-error" : undefined}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="hourly_rate_pounds"
              className="block text-sm font-medium text-ink"
            >
              Hourly rate (&pound;)
            </label>
            <Input
              id="hourly_rate_pounds"
              name="hourly_rate_pounds"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={penceToPoundsString(
                profile?.hourly_rate_pence ?? null,
              )}
              aria-describedby={error ? "form-error" : "rate-hint"}
            />
            <p id="rate-hint" className="text-xs text-ink-muted">
              In pounds, for example 22.50.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Save profile
          </button>
          <Link
            href="/provider"
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Back to dashboard
          </Link>
        </div>
      </form>

      <div className="space-y-3">
        {catalogSections.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-ink">{row.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{row.detail}</p>
            </div>
            <Link
              href={row.href}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              {row.hrefLabel}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
