import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getCompanyProfileWithCatalog,
} from "@/lib/companies/profile-actions";
import { listCapabilities } from "@/lib/providers/catalog";
import { createServerClient } from "@/lib/supabase/server";

import { submitCompanyCapabilities } from "./actions";

export const metadata = {
  title: "Company capabilities - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export default async function CompanyCapabilitiesPage({
  searchParams,
}: PageProps) {
  const { error, saved } = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      "/auth/sign-in?error=sign-in-required&next=/provider/company/capabilities",
    );
  }

  const [capabilities, catalog] = await Promise.all([
    listCapabilities(),
    getCompanyProfileWithCatalog(),
  ]);
  const selected = new Set(catalog?.capabilityIds ?? []);

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          Company capabilities
        </h1>
        <p className="text-ink-muted">
          Select the specialist capabilities your company team can deliver.
        </p>
      </header>

      {saved ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          Capabilities saved.
        </div>
      ) : null}

      {error ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form
        action={submitCompanyCapabilities}
        className="space-y-5 rounded-2xl border border-border bg-surface p-6"
        noValidate
      >
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">
            Capabilities
          </legend>
          {capabilities.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No capabilities are defined yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {capabilities.map((cap) => {
                const inputId = `capability-${cap.id}`;
                return (
                  <li key={cap.id} className="flex items-start gap-3">
                    <input
                      id={inputId}
                      type="checkbox"
                      name="capability_id"
                      value={cap.id}
                      defaultChecked={selected.has(cap.id)}
                      aria-describedby={error ? "form-error" : undefined}
                      className="mt-1 h-4 w-4 rounded border-border text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                    />
                    <label
                      htmlFor={inputId}
                      className="flex-1 text-sm text-ink"
                    >
                      <span className="font-medium">{cap.name}</span>
                      {cap.description ? (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {cap.description}
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Save capabilities
          </button>
          <Link
            href="/provider/company"
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Back to company dashboard
          </Link>
        </div>
      </form>
    </section>
  );
}
