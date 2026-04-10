import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

/*
 * C7a public provider profile viewer (story 20). Server Component.
 *
 * Lives under `(public)`, so only the neutral semantic palette is used -
 * no `bg-brand`, `text-brand`, or `ring-brand-ring`. The unified brand
 * mark in the public layout chrome is the only brand element on the page.
 *
 * Data fetch uses the user-scoped Supabase client via `createServerClient()`.
 * Anon RLS on `provider_profiles` (migration 0004) + the public_read policy
 * filter to verified, non-soft-deleted rows; unauthenticated callers will
 * see `null` for a draft or soft-deleted profile and fall through to 404.
 * The anon column grant covers `id, headline, bio, city, country,
 * years_experience, hourly_rate_pence, verified_at, service_radius_km`.
 * M-1: `service_postcode`, `latitude`, `longitude`, `geocoded_at`, and
 * `deleted_at` are withheld from the anon grant and must not be referenced
 * in select() or filter() calls - doing so raises "permission denied" for
 * anon callers.
 * Soft-delete filtering is enforced transitively by the public_read RLS
 * policy, which the planner evaluates against the full column set.
 *
 * Mirrors the parallel-query shape of `lib/providers/catalog.ts` because
 * the nested-select PostgREST syntax would need embedded filter hints
 * to exclude soft-deleted certifications cleanly.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("provider_profiles")
    .select("headline")
    .eq("id", id)
    .not("verified_at", "is", null)
    .maybeSingle();
  const headline = (data as { headline: string | null } | null)?.headline;
  return {
    title: headline
      ? `${headline} - Care provider - MyCareProvider`
      : "Care provider - MyCareProvider",
  };
}

type ProviderProfilePublic = {
  id: string;
  headline: string | null;
  bio: string | null;
  city: string | null;
  country: string | null;
  years_experience: number | null;
  hourly_rate_pence: number | null;
  verified_at: string | null;
  service_radius_km: number | null;
};

type CatalogEntry = { slug: string; name: string } | null;

type ServiceRow = {
  service_categories: CatalogEntry | CatalogEntry[] | null;
};

type CapabilityRow = {
  capabilities: CatalogEntry | CatalogEntry[] | null;
};

type CertificationRow = {
  id: string;
  issued_on: string | null;
  expires_on: string | null;
  certifications: CatalogEntry | CatalogEntry[] | null;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

function formatPounds(pence: number | null): string | null {
  if (pence === null) return null;
  return `£${(pence / 100).toFixed(2)}`;
}

function formatMonthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
  });
}

export default async function ProviderProfileViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();

  const [profileRes, servicesRes, capabilitiesRes, certsRes] =
    await Promise.all([
      supabase
        .from("provider_profiles")
        .select(
          "id, headline, bio, city, country, years_experience, hourly_rate_pence, verified_at, service_radius_km",
        )
        .eq("id", id)
        .not("verified_at", "is", null)
        .maybeSingle(),
      supabase
        .from("provider_services")
        .select(
          "service_categories:service_categories ( slug, name, sort_order )",
        )
        .eq("provider_id", id),
      supabase
        .from("provider_capabilities")
        .select("capabilities:capabilities ( slug, name, sort_order )")
        .eq("provider_id", id),
      supabase
        .from("provider_certifications")
        .select(
          "id, issued_on, expires_on, certifications:certifications ( slug, name )",
        )
        .eq("provider_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (profileRes.error) {
    throw new Error(`ProviderProfileViewer profile: ${profileRes.error.message}`);
  }
  if (!profileRes.data) {
    notFound();
  }
  if (servicesRes.error) {
    throw new Error(
      `ProviderProfileViewer services: ${servicesRes.error.message}`,
    );
  }
  if (capabilitiesRes.error) {
    throw new Error(
      `ProviderProfileViewer capabilities: ${capabilitiesRes.error.message}`,
    );
  }
  if (certsRes.error) {
    throw new Error(
      `ProviderProfileViewer certifications: ${certsRes.error.message}`,
    );
  }

  const profile = profileRes.data as ProviderProfilePublic;

  const services = ((servicesRes.data ?? []) as ServiceRow[])
    .map((r) => firstOrNull(r.service_categories))
    .filter((s): s is { slug: string; name: string } => s !== null);

  const capabilities = ((capabilitiesRes.data ?? []) as CapabilityRow[])
    .map((r) => firstOrNull(r.capabilities))
    .filter((c): c is { slug: string; name: string } => c !== null);

  const certifications = ((certsRes.data ?? []) as CertificationRow[])
    .map((r) => ({
      id: r.id,
      issuedOn: r.issued_on,
      expiresOn: r.expires_on,
      cert: firstOrNull(r.certifications),
    }))
    .filter(
      (r): r is { id: string; issuedOn: string | null; expiresOn: string | null; cert: { slug: string; name: string } } =>
        r.cert !== null,
    );

  const hourlyRate = formatPounds(profile.hourly_rate_pence);
  const verifiedSince = formatMonthYear(profile.verified_at);

  // Role-aware contact CTA. This is the ONE `(public)` surface allowed to
  // inspect the viewer's role, per the C8 task scope: signed-in receivers
  // jump straight into the themed contact form, signed-out visitors are
  // routed through sign-up, and signed-in providers/admins see a disabled
  // affordance with an explanatory label. The JWT claim is read inline
  // via `createServerClient()` so no other public page grows a role
  // dependency.
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const viewerRole =
    (viewer?.app_metadata?.app_role as string | undefined) ??
    (viewer?.user_metadata?.role as string | undefined) ??
    null;
  const contactTargetPath = `/receiver/contacts/new?provider=${profile.id}`;
  const canContact =
    viewer !== null &&
    (viewerRole === "receiver" || viewerRole === "family_member");
  let contactHref: string;
  let contactLabel: string;
  let contactDisabled = false;
  let contactAria: string | undefined;
  if (canContact) {
    contactHref = contactTargetPath;
    contactLabel = "Contact this provider";
  } else if (!viewer) {
    contactHref = `/auth/sign-up?return=${encodeURIComponent(contactTargetPath)}`;
    contactLabel = "Contact this provider";
  } else {
    // Signed-in provider or admin - the action is not valid for them.
    contactHref = "#";
    contactLabel = "Contact this provider";
    contactDisabled = true;
    contactAria = "Only care receivers can send contact requests";
  }

  return (
    <article className="mx-auto max-w-3xl px-6 py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm">
        <Link
          href="/providers"
          className="rounded-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          ← Back to directory
        </Link>
      </nav>

      <header className="rounded-2xl border-2 border-border bg-surface p-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          {profile.headline ?? "Care provider"}
        </h1>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-muted">Location</dt>
            <dd className="mt-1 font-medium text-ink">
              {profile.city ?? "Not provided"}
            </dd>
          </div>
          {profile.years_experience !== null ? (
            <div>
              <dt className="text-ink-muted">Experience</dt>
              <dd className="mt-1 font-medium text-ink">
                {profile.years_experience} years
              </dd>
            </div>
          ) : null}
          {verifiedSince ? (
            <div>
              <dt className="text-ink-muted">Verified since</dt>
              <dd className="mt-1 font-medium text-ink">{verifiedSince}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {profile.bio ? (
        <section className="mt-8" aria-labelledby="about-heading">
          <h2
            id="about-heading"
            className="font-heading text-xl font-bold text-ink"
          >
            About
          </h2>
          <p className="mt-3 whitespace-pre-line text-base text-ink-muted">
            {profile.bio}
          </p>
        </section>
      ) : null}

      {services.length > 0 ? (
        <section className="mt-8" aria-labelledby="services-heading">
          <h2
            id="services-heading"
            className="font-heading text-xl font-bold text-ink"
          >
            Services offered
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {services.map((s) => (
              <li
                key={s.slug}
                className="rounded-full border border-border bg-canvas px-3 py-1 text-sm text-ink"
              >
                {s.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {capabilities.length > 0 ? (
        <section className="mt-8" aria-labelledby="capabilities-heading">
          <h2
            id="capabilities-heading"
            className="font-heading text-xl font-bold text-ink"
          >
            Capabilities
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {capabilities.map((c) => (
              <li
                key={c.slug}
                className="rounded-full border border-border bg-canvas px-3 py-1 text-sm text-ink"
              >
                {c.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {certifications.length > 0 ? (
        <section className="mt-8" aria-labelledby="certifications-heading">
          <h2
            id="certifications-heading"
            className="font-heading text-xl font-bold text-ink"
          >
            Certifications
          </h2>
          <ul className="mt-3 space-y-3">
            {certifications.map((c) => {
              const issued = formatMonthYear(c.issuedOn);
              const expires = formatMonthYear(c.expiresOn);
              return (
                <li
                  key={c.id}
                  className="rounded-xl border border-border bg-canvas p-4"
                >
                  <p className="font-medium text-ink">{c.cert.name}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {issued ? `Issued ${issued}` : "Issue date not provided"}
                    {expires ? ` · Expires ${expires}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section
        className="mt-8 rounded-2xl border-2 border-border bg-surface p-6"
        aria-labelledby="rates-heading"
      >
        <h2 id="rates-heading" className="font-heading text-xl font-bold text-ink">
          Rates and service area
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-muted">Hourly rate</dt>
            <dd className="mt-1 font-medium text-ink">
              {hourlyRate ? `${hourlyRate}/hr` : "On request"}
            </dd>
          </div>
          {profile.service_radius_km !== null ? (
            <div>
              <dt className="text-ink-muted">Service radius</dt>
              <dd className="mt-1 font-medium text-ink">
                {profile.service_radius_km} km
              </dd>
            </div>
          ) : null}
          {/* M-1: service_postcode withheld from anon grant - service area
              is represented by the radius only on the public viewer. */}
        </dl>
      </section>

      <section
        className="mt-10 rounded-2xl border-2 border-border bg-surface p-6 text-center"
        aria-labelledby="contact-heading"
      >
        <h2 id="contact-heading" className="font-heading text-xl font-bold text-ink">
          Interested in this provider?
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {canContact
            ? "Send a contact request and introduce yourself."
            : contactDisabled
              ? "Contact requests can only be sent by care receivers."
              : "Create a free account to send a contact request."}
        </p>
        {contactDisabled ? (
          <span
            role="button"
            aria-disabled="true"
            aria-label={contactAria}
            className="mt-4 inline-flex h-11 cursor-not-allowed items-center justify-center rounded-xl border border-border bg-canvas px-5 text-base font-medium text-ink-muted"
          >
            {contactLabel}
          </span>
        ) : (
          <Link
            href={contactHref}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            {contactLabel}
          </Link>
        )}
      </section>
    </article>
  );
}
