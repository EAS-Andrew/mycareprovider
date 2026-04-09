import Link from "next/link";
import { redirect } from "next/navigation";
import { signUpProvider } from "@/lib/providers/actions";
import { Input } from "@/components/ui/input";

export const metadata = {
  title: "Register as a care provider - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

async function submitProviderSignUp(formData: FormData): Promise<void> {
  "use server";
  if (formData.get("confirm_provider") !== "yes") {
    redirect("/auth/provider-sign-up?error=confirm-required");
  }
  await signUpProvider(formData);
}

export default async function ProviderSignUpPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const errorMessage =
    error === "confirm-required"
      ? "Please confirm that you are registering as an individual care provider."
      : (error ?? null);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Register as a care provider
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Create an individual care provider account. You will complete your
        profile and upload verification documents on the next step.
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

      <form action={submitProviderSignUp} className="mt-6 space-y-5" noValidate>
        <div className="space-y-2">
          <label
            htmlFor="display_name"
            className="block text-sm font-medium text-ink"
          >
            Display name
          </label>
          <Input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="name"
            aria-describedby="display-name-hint"
          />
          <p id="display-name-hint" className="text-xs text-ink-muted">
            How you would like to be addressed by care receivers. Optional.
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
              id="confirm_provider"
              name="confirm_provider"
              type="checkbox"
              value="yes"
              required
              aria-describedby="confirm-provider-hint"
              className="mt-1 size-4 rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            />
            <label htmlFor="confirm_provider" className="text-sm text-ink">
              I confirm I am registering as an individual care provider.
            </label>
          </div>
          <p id="confirm-provider-hint" className="text-xs text-ink-muted">
            Care providers must complete identity and DBS checks before their
            profile is visible to care receivers.
          </p>
        </div>

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Create provider account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Looking for care instead?{" "}
        <Link href="/auth/sign-up" className="font-medium text-ink underline">
          Create a care receiver account
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
