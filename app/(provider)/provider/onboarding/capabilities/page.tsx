import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getProviderProfileWithCatalog,
  listCapabilities,
  listServiceCategories,
  type Capability,
} from "@/lib/providers/catalog";
import { createServerClient } from "@/lib/supabase/server";

import { submitProviderCapabilities } from "./actions";

export const metadata = {
  title: "Your capabilities - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; saved?: string }>;
};

function CapabilityCheckbox({
  cap,
  checked,
  describedBy,
}: {
  cap: Capability;
  checked: boolean;
  describedBy: string | undefined;
}) {
  const inputId = `cap-${cap.id}`;
  return (
    <li className="flex items-start gap-3">
      <input
        id={inputId}
        type="checkbox"
        name="capability_id"
        value={cap.id}
        defaultChecked={checked}
        aria-describedby={describedBy}
        className="mt-1 h-4 w-4 rounded border-border text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      />
      <label htmlFor={inputId} className="flex-1 text-sm text-ink">
        <span className="font-medium">{cap.name}</span>
        {cap.description ? (
          <span className="mt-0.5 block text-xs text-ink-muted">
            {cap.description}
          </span>
        ) : null}
      </label>
    </li>
  );
}

export default async function ProviderCapabilitiesPage({
  searchParams,
}: PageProps) {
  const { error, saved } = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      "/auth/sign-in?error=sign-in-required&next=/provider/onboarding/capabilities",
    );
  }

  const [categories, capabilities, selection] = await Promise.all([
    listServiceCategories(),
    listCapabilities(),
    getProviderProfileWithCatalog(user.id),
  ]);
  const selected = new Set(selection.capabilityIds);

  const grouped = new Map<string, Capability[]>();
  const ungrouped: Capability[] = [];
  for (const cap of capabilities) {
    if (cap.service_category_id) {
      const arr = grouped.get(cap.service_category_id) ?? [];
      arr.push(cap);
      grouped.set(cap.service_category_id, arr);
    } else {
      ungrouped.push(cap);
    }
  }

  const describedBy = error ? "form-error" : undefined;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          Your capabilities
        </h1>
        <p className="text-ink-muted">
          Tick the specific training or skills you hold. These help families
          find the right carer.
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
        action={submitProviderCapabilities}
        className="space-y-6 rounded-2xl border border-border bg-surface p-6"
        noValidate
      >
        {categories.map((cat) => {
          const caps = grouped.get(cat.id) ?? [];
          if (caps.length === 0) return null;
          return (
            <fieldset key={cat.id} className="space-y-3">
              <legend className="text-sm font-medium text-ink">
                {cat.name}
              </legend>
              <ul className="space-y-3">
                {caps.map((cap) => (
                  <CapabilityCheckbox
                    key={cap.id}
                    cap={cap}
                    checked={selected.has(cap.id)}
                    describedBy={describedBy}
                  />
                ))}
              </ul>
            </fieldset>
          );
        })}

        {ungrouped.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">Other</legend>
            <ul className="space-y-3">
              {ungrouped.map((cap) => (
                <CapabilityCheckbox
                  key={cap.id}
                  cap={cap}
                  checked={selected.has(cap.id)}
                  describedBy={describedBy}
                />
              ))}
            </ul>
          </fieldset>
        ) : null}

        {capabilities.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No capabilities are defined yet.
          </p>
        ) : null}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Save capabilities
          </button>
          <Link
            href="/provider/onboarding"
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Back to onboarding
          </Link>
        </div>
      </form>
    </section>
  );
}
