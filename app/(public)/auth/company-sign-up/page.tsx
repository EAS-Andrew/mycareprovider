import Link from "next/link";
import { redirect } from "next/navigation";
import { signUpCompany } from "@/lib/companies/actions";
import { Input } from "@/components/ui/input";

export const metadata = {
  title: "Register a care provider company - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

async function submitCompanySignUp(formData: FormData): Promise<void> {
  "use server";
  if (formData.get("confirm_company") !== "yes") {
    redirect("/auth/company-sign-up?error=confirm-required");
  }
  await signUpCompany(formData);
}

export default async function CompanySignUpPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const errorMessage =
    error === "confirm-required"
      ? "Please confirm that you are registering as a care provider company."
      : (error ?? null);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Register a care provider company
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Create an account for your care provider company. You will complete your
        company profile and upload verification documents on the next step.
      </p>

      {errorMessage ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="mt-6 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {errorMessage}
        </div>
      ) : null}

      <form action={submitCompanySignUp} className="mt-6 space-y-5" noValidate>
        <div className="space-y-2">
          <label
            htmlFor="company_name"
            className="block text-sm font-medium text-ink"
          >
            Company name
          </label>
          <Input
            id="company_name"
            name="company_name"
            type="text"
            required
            aria-describedby="company-name-hint"
          />
          <p id="company-name-hint" className="text-xs text-ink-muted">
            The registered name of your care provider company.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="display_name"
            className="block text-sm font-medium text-ink"
          >
            Display name (optional)
          </label>
          <Input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="organization"
            aria-describedby="display-name-hint"
          />
          <p id="display-name-hint" className="text-xs text-ink-muted">
            If different from the company name. Shown in the provider directory.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-ink"
          >
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={errorMessage ? "form-error" : undefined}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-ink"
          >
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="text-xs text-ink-muted">
            At least 8 characters.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <input
              id="confirm_company"
              name="confirm_company"
              type="checkbox"
              value="yes"
              required
              aria-describedby="confirm-company-hint"
              className="mt-1 size-4 rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            />
            <label htmlFor="confirm_company" className="text-sm text-ink">
              I confirm I am registering on behalf of a care provider company.
            </label>
          </div>
          <p id="confirm-company-hint" className="text-xs text-ink-muted">
            Companies must provide Companies House registration details and
            upload verification documents before their profile is visible.
          </p>
        </div>

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Create company account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Registering as an individual provider?{" "}
        <Link
          href="/auth/provider-sign-up"
          className="font-medium text-ink underline"
        >
          Individual provider sign-up
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="font-medium text-ink underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
