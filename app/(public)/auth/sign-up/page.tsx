import Link from "next/link";
import { signUp } from "@/lib/auth/actions";
import { Input } from "@/components/ui/input";

export const metadata = {
  title: "Create an account - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignUpPage({ searchParams }: PageProps) {
  const { error } = await searchParams;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Create your account
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Sign up to find care for yourself or a loved one. Care providers and
        administrators join by invitation only.
      </p>

      {error ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="mt-6 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form action={signUp} className="mt-6 space-y-5" noValidate>
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
            aria-describedby={error ? "form-error" : undefined}
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
    </>
  );
}
