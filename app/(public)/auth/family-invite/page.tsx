import Link from "next/link";

import { Input } from "@/components/ui/input";
import { signUpFamilyMember, acceptInvitation } from "@/lib/care-circles/actions";
import { getInvitationByToken } from "@/lib/care-circles/queries";

export const metadata = {
  title: "Join a care circle - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "This invitation link is not valid.",
  already_accepted: "This invitation has already been accepted.",
  expired: "This invitation has expired. Ask for a new one.",
  signup_failed:
    "Something went wrong creating your account. Please try again.",
  unknown: "Something went wrong. Please try again.",
};

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
}

export default async function FamilyInvitePage({ searchParams }: PageProps) {
  const { token, error } = await searchParams;
  const errorText = errorMessage(error);

  if (!token) {
    return (
      <>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
          Join a care circle
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          You need an invitation link to join a care circle. Ask a family
          member or care receiver to send you one.
        </p>
        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link
            href="/auth/sign-in"
            className="font-medium text-ink underline"
          >
            Sign in
          </Link>
        </p>
      </>
    );
  }

  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return (
      <>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
          Invalid invitation
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          This invitation link is not valid or has expired. Please ask for a
          new invitation.
        </p>
        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link
            href="/auth/sign-in"
            className="font-medium text-ink underline"
          >
            Sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
        Join a care circle
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        You have been invited to join a family care circle as a{" "}
        <strong>{invitation.role === "primary" ? "primary member" : "member"}</strong>.
        Create an account to get started.
      </p>

      {errorText && (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="mt-6 rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {errorText}
        </div>
      )}

      <form
        action={signUpFamilyMember}
        className="mt-6 space-y-5"
        noValidate
      >
        <input type="hidden" name="token" value={token} />

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
            defaultValue={invitation.email}
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
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Create account and join
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="font-medium text-ink underline">
          Sign in
        </Link>{" "}
        and accept the invitation from your family circle page.
      </p>
    </>
  );
}
