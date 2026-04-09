import Link from "next/link";
import { signIn } from "@/lib/auth/actions";
import { Input } from "@/components/ui/input";

export const metadata = {
  title: "Sign in - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const { error, next } = await searchParams;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Sign in
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Welcome back. Enter your email and password.
      </p>

      {error ? (
        <div
          role="alert"
          tabIndex={-1}
          className="mt-6 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form action={signIn} className="mt-6 space-y-5" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}

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
            autoComplete="current-password"
            required
            aria-describedby={error ? "form-error" : undefined}
          />
        </div>

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Sign in
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        New to MyCareProvider?{" "}
        <Link href="/auth/sign-up" className="font-medium text-ink underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
