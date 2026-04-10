import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getCompanyProfileWithCatalog,
} from "@/lib/companies/profile-actions";
import { listServiceCategories } from "@/lib/providers/catalog";
import { createServerClient } from "@/lib/supabase/server";

import { submitCompanyServices } from "./actions";

export const metadata = {
  title: "Company services - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export default async function CompanyServicesPage({ searchParams }: PageProps) {
  const { error, saved } = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      "/auth/sign-in?error=sign-in-required&next=/provider/company/services",
    );
  }

  const [categories, catalog] = await Promise.all([
    listServiceCategories(),
    getCompanyProfileWithCatalog(),
  ]);
  const selected = new Set(catalog?.serviceCategoryIds ?? []);

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          Company services
        </h1>
        <p className="text-ink-muted">
          Select every service your company offers. You can change this at any
          time.
        </p>
      </header>

      {saved ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          Services saved.
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
        action={submitCompanyServices}
        className="space-y-5 rounded-2xl border border-border bg-surface p-6"
        noValidate
      >
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">
            Service categories
          </legend>
          {categories.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No service categories are defined yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {categories.map((cat) => {
                const inputId = `service-${cat.id}`;
                return (
                  <li key={cat.id} className="flex items-start gap-3">
                    <input
                      id={inputId}
                      type="checkbox"
                      name="service_category_id"
                      value={cat.id}
                      defaultChecked={selected.has(cat.id)}
                      aria-describedby={error ? "form-error" : undefined}
                      className="mt-1 h-4 w-4 rounded border-border text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                    />
                    <label
                      htmlFor={inputId}
                      className="flex-1 text-sm text-ink"
                    >
                      <span className="font-medium">{cat.name}</span>
                      {cat.description ? (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {cat.description}
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
            Save services
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
