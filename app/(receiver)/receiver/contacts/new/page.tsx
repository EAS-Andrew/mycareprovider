import Link from "next/link";

import { Input } from "@/components/ui/input";
import { createServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Send a contact request - MyCareProvider",
};

/*
 * Receiver-side new contact request form. Accepts `?provider=<id>` and
 * pre-fills the hidden provider_id. If no provider is supplied we fall
 * back to a short message linking to the directory, rather than letting
 * the user write a message with no target.
 *
 * Theme comes from the `(receiver)` group layout - `bg-brand` is the
 * receiver blue here.
 */

type PageProps = {
  searchParams: Promise<{
    provider?: string;
    error?: string;
  }>;
};

export default async function ReceiverContactNewPage({ searchParams }: PageProps) {
  const { provider, error } = await searchParams;

  if (!provider) {
    return (
      <section className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Choose a provider first
        </h1>
        <p className="text-ink-muted">
          Open a provider&rsquo;s profile from the directory, then use the
          &ldquo;Contact this provider&rdquo; button to start a message.
        </p>
        <Link
          href="/providers"
          className="inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Browse providers
        </Link>
      </section>
    );
  }

  // Look up the provider's public headline so the form gives the sender
  // confidence that they have the right target. The user-scoped client
  // hits `provider_profiles_public_read`, so unverified/soft-deleted rows
  // come back as null - which is fine, the backend action will reject the
  // submission with `provider_not_available` anyway.
  const supabase = await createServerClient();
  const { data: providerRow } = await supabase
    .from("provider_profiles")
    .select("headline")
    .eq("id", provider)
    .not("verified_at", "is", null)
    .maybeSingle();

  const headline =
    (providerRow as { headline: string | null } | null)?.headline ?? null;

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Send a contact request
        </h1>
        <p className="text-ink-muted">
          Introduce yourself and explain what you are looking for. The
          provider will see your name and message, and can accept or
          decline.
        </p>
        {headline ? (
          <p className="text-sm text-ink">
            Sending to <span className="font-medium">{headline}</span>
          </p>
        ) : null}
      </header>

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

      {/*
        Submit via a plain HTML POST to the Route Handler so the C8 BotID
        gate and per-IP rate limit run before any server-side logic.
        See `app/api/contact/create/route.ts` and contact-findings C-3.
      */}
      <form
        action="/api/contact/create"
        method="POST"
        className="space-y-5 rounded-lg border border-border bg-surface p-6"
        noValidate
      >
        <input type="hidden" name="provider_id" value={provider} />

        <div className="space-y-2">
          <label htmlFor="subject" className="block text-sm font-medium text-ink">
            Subject
          </label>
          <Input
            id="subject"
            name="subject"
            type="text"
            required
            minLength={3}
            maxLength={120}
            aria-describedby={error ? "form-error" : "subject-hint"}
          />
          <p id="subject-hint" className="text-xs text-ink-muted">
            One line, for example &ldquo;Weekday mornings for my mother&rdquo;.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="body" className="block text-sm font-medium text-ink">
            Message
          </label>
          <textarea
            id="body"
            name="body"
            rows={8}
            required
            minLength={10}
            maxLength={2000}
            aria-describedby={error ? "form-error" : "body-hint"}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
          />
          <p id="body-hint" className="text-xs text-ink-muted">
            Up to 2000 characters. Do not include sensitive medical details
            in this first message.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Send request
          </button>
          <Link
            href={`/providers/${provider}`}
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Back to provider profile
          </Link>
        </div>
      </form>
    </section>
  );
}
