import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteAdmin } from "@/lib/auth/actions";

export const metadata = {
  title: "Invite admin - Administrator",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function InviteAdminPage({ searchParams }: PageProps) {
  const { error, ok } = await searchParams;

  return (
    <section className="mx-auto max-w-xl">
      <div className="mb-6">
        <Link href="/admin/users" className="text-sm text-ink-muted underline">
          &larr; Back to users
        </Link>
      </div>

      <h1 className="font-heading text-3xl font-bold tracking-tight">Invite admin</h1>
      <p className="mt-2 text-ink-muted">
        Send an invitation email. The recipient will receive a magic link to
        finish setting up their administrator account.
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

      {ok ? (
        <div
          role="status"
          className="mt-6 rounded-md border border-success bg-canvas p-4 text-sm text-ink"
        >
          <p className="font-medium text-ink">Invitation sent.</p>
          <p className="mt-1 text-ink-muted">
            The new administrator will receive an email shortly.
          </p>
          <div className="mt-4 flex gap-3">
            <Link href="/admin" className={buttonStyles({ variant: "outline" })}>
              Back to console
            </Link>
            <Link
              href="/admin/users"
              className={buttonStyles({ variant: "ghost" })}
            >
              View users
            </Link>
          </div>
        </div>
      ) : (
        <form action={inviteAdmin} className="mt-6 space-y-5" noValidate>
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
              autoComplete="off"
              aria-describedby="display-name-hint"
            />
            <p id="display-name-hint" className="text-xs text-ink-muted">
              How the new admin will be shown in the users list. Optional.
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
              autoComplete="off"
              required
              aria-describedby={error ? "form-error" : undefined}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit">Send invitation</Button>
            <Link
              href="/admin/users"
              className={buttonStyles({ variant: "ghost" })}
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
