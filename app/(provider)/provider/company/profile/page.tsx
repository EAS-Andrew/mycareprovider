import { getCompanyProfile } from "@/lib/companies/queries";
import { updateCompanyProfile } from "@/lib/companies/actions";
import { Input } from "@/components/ui/input";

export const metadata = {
  title: "Company profile - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export default async function CompanyProfilePage({ searchParams }: PageProps) {
  const { error, saved } = await searchParams;
  const profile = await getCompanyProfile();

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Company profile
        </h1>
        <p className="mt-1 text-ink-muted">
          Keep your company details up to date. Your profile will be visible to
          care receivers once verified by our team.
        </p>
      </header>

      {saved ? (
        <div
          role="status"
          className="rounded-md border border-success bg-surface p-3 text-sm text-ink"
        >
          Company profile saved.
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

      <form action={updateCompanyProfile} className="space-y-5" noValidate>
        <div className="space-y-2">
          <label
            htmlFor="company_name"
            className="block text-sm font-medium text-ink"
          >
            Company name *
          </label>
          <Input
            id="company_name"
            name="company_name"
            type="text"
            required
            defaultValue={profile?.company_name ?? ""}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="company_number"
            className="block text-sm font-medium text-ink"
          >
            Companies House number
          </label>
          <Input
            id="company_number"
            name="company_number"
            type="text"
            defaultValue={profile?.company_number ?? ""}
            aria-describedby="company-number-hint"
          />
          <p id="company-number-hint" className="text-xs text-ink-muted">
            Your 8-character Companies House registration number.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="registered_address"
            className="block text-sm font-medium text-ink"
          >
            Registered address
          </label>
          <textarea
            id="registered_address"
            name="registered_address"
            rows={3}
            defaultValue={profile?.registered_address ?? ""}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="service_postcode"
            className="block text-sm font-medium text-ink"
          >
            Service area postcode
          </label>
          <Input
            id="service_postcode"
            name="service_postcode"
            type="text"
            defaultValue={profile?.service_postcode ?? ""}
            aria-describedby="service-postcode-hint"
          />
          <p id="service-postcode-hint" className="text-xs text-ink-muted">
            The centre of your service area. Used to help care receivers find
            local providers.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="description"
            className="block text-sm font-medium text-ink"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={profile?.description ?? ""}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50"
            aria-describedby="description-hint"
          />
          <p id="description-hint" className="text-xs text-ink-muted">
            Tell care receivers about the services your company provides.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="website"
            className="block text-sm font-medium text-ink"
          >
            Website
          </label>
          <Input
            id="website"
            name="website"
            type="url"
            defaultValue={profile?.website ?? ""}
          />
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
          />
        </div>

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Save company profile
        </button>
      </form>
    </section>
  );
}
