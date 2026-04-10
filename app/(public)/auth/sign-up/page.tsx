import Link from "next/link";
import { signUp } from "@/lib/auth/actions";
import { Input } from "@/components/ui/input";

export const metadata = {
  title: "Create an account - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; return?: string }>;
};

// Finding auth#11: map whitelisted error codes to friendly strings instead
// of reflecting raw Supabase error messages.
const ERROR_MESSAGES: Record<string, string> = {
  email_taken: "An account with that email already exists. Try signing in.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  missing_field: "Please fill in every required field and try again.",
  unknown: "Something went wrong creating your account. Please try again.",
};

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
}

export default async function SignUpPage({ searchParams }: PageProps) {
  const { error, return: returnTo } = await searchParams;
  const errorText = errorMessage(error);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Create your account
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Sign up to find care for yourself or a loved one. Care providers and
        administrators join by invitation only.
      </p>

      {errorText ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="mt-6 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {errorText}
        </div>
      ) : null}

      <form action={signUp} className="mt-6 space-y-5" noValidate>
        {returnTo ? (
          <input type="hidden" name="next" value={returnTo} />
        ) : null}
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
            How you would like to be addressed. Optional.
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
            aria-describedby={errorText ? "form-error" : undefined}
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

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Create account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="font-medium text-ink underline">
          Sign in
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-ink-muted">
        Are you a care provider?{" "}
        <Link
          href="/auth/provider-sign-up"
          className="font-medium text-ink underline"
        >
          Register here
        </Link>
      </p>
    </>
  );
}
