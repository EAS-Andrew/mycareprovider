import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { inviteFamilyMember } from "@/lib/care-circles/actions";

export const metadata = {
  title: "Invite family member - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  missing_field: "Please fill in every required field and try again.",
  unknown: "Something went wrong. Please try again.",
};

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
}

export default async function InviteFamilyMemberPage({
  searchParams,
}: PageProps) {
  const { error } = await searchParams;
  const errorText = errorMessage(error);

  return (
    <section className="mx-auto max-w-lg space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Invite a family member
        </h1>
        <p className="mt-2 text-ink-muted">
          Send an invitation to a family member so they can join your care
          circle and help coordinate care.
        </p>
      </header>

      {errorText && (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {errorText}
        </div>
      )}

      <form action={inviteFamilyMember} className="space-y-5" noValidate>
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-ink"
          >
            Email address
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={errorText ? "form-error" : undefined}
          />
          <p className="text-xs text-ink-muted">
            They will receive an email with a link to join your care circle.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="role"
            className="block text-sm font-medium text-ink"
          >
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue="member"
            className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink ring-offset-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <option value="member">Member</option>
            <option value="primary">Primary (can manage the circle)</option>
          </select>
        </div>

        <div className="flex gap-3">
          <Button type="submit">Send invitation</Button>
          <Link href="/receiver/family">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </section>
  );
}
