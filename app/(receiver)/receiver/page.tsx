import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ReceiverHome() {
  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome, care receiver
        </h1>
        <p className="mt-3 text-ink-muted">
          This is where you will find providers, arrange visits, and manage care
          for yourself or someone you love.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/providers"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:bg-surface-hover"
        >
          <h2 className="font-semibold text-ink">Find a provider</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Browse verified care providers in your area.
          </p>
        </Link>
        <Link
          href="/receiver/messages"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:bg-surface-hover"
        >
          <h2 className="font-semibold text-ink">Messages</h2>
          <p className="mt-1 text-sm text-ink-muted">
            View conversations with your care providers.
          </p>
        </Link>
        <Link
          href="/receiver/contacts"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:bg-surface-hover"
        >
          <h2 className="font-semibold text-ink">Contact requests</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Track your outreach to providers.
          </p>
        </Link>
        <Link
          href="/receiver/care-plans"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:bg-surface-hover"
        >
          <h2 className="font-semibold text-ink">Care plans</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Review and approve care plans from your providers.
          </p>
        </Link>
      </div>
    </section>
  );
}
