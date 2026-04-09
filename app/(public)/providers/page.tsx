import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  listServiceCategories,
  listCapabilities,
} from "@/lib/providers/catalog";
import {
  searchProviders,
  resolveSearchLocation,
  type ProviderSearchFilters,
} from "@/lib/search/provider-search";

/*
 * C7a public provider directory (story 18). Lives under `(public)`, so the
 * surface is audience-unknown: unified brand mark in the layout chrome, and
 * only the neutral semantic palette (`bg-canvas`, `bg-surface`, `text-ink`,
 * `border-border`) on this page. No `bg-brand` / `text-brand` /
 * `ring-brand-ring` - those are role-themed and wrong here.
 *
 * Server Component by default. The filter form posts via plain HTML GET so
 * the URL is the entire source of truth and results are shareable. The
 * search call goes directly through `searchProviders` (not the JSON route
 * handler); the route handler exists for external API consumers and would
 * just add a network hop here.
 */

export const metadata = {
  title: "Find a care provider - MyCareProvider",
  description:
    "Search verified care providers across the UK. Filter by area, service, and capability.",
};

const PAGE_SIZE = 20;
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
const DEFAULT_RADIUS = "25";

type SearchParams = {
  q?: string;
  near?: string;
  radius?: string;
  service?: string;
  capability?: string;
  offset?: string;
  error?: string;
};

function parseOffset(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function formatPounds(pence: number | null): string | null {
  if (pence === null) return null;
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function ProvidersDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const nearRaw = sp.near ?? "";
  const radiusRaw = sp.radius ?? DEFAULT_RADIUS;
  const serviceSlug = sp.service ?? "";
  const capabilitySlug = sp.capability ?? "";
  const offset = parseOffset(sp.offset);
  const error = sp.error;

  const [serviceCategories, capabilities, near] = await Promise.all([
    listServiceCategories(),
    listCapabilities(),
    resolveSearchLocation(nearRaw, radiusRaw),
  ]);

  // Silently drop an un-geocodeable postcode: per backend-engineer's
  // contract, `resolveSearchLocation` returns undefined for missing,
  // malformed, or un-geocodeable input, and the caller treats that as "no
  // radius filter". We still surface a gentle note below when the user
  // typed a postcode but nothing resolved.
  const postcodeGiven = nearRaw.trim().length > 0;
  const postcodeResolved = near !== undefined;

  const filters: ProviderSearchFilters = {
    query: q.length > 0 ? q : undefined,
    near,
    serviceSlug: serviceSlug.length > 0 ? serviceSlug : undefined,
    capabilitySlug: capabilitySlug.length > 0 ? capabilitySlug : undefined,
    limit: PAGE_SIZE,
    offset,
  };

  const results = await searchProviders(filters);

  const hasNext = results.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  function buildHref(nextOffset: number): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (nearRaw) params.set("near", nearRaw);
    if (radiusRaw && radiusRaw !== DEFAULT_RADIUS) {
      params.set("radius", radiusRaw);
    }
    if (serviceSlug) params.set("service", serviceSlug);
    if (capabilitySlug) params.set("capability", capabilitySlug);
    if (nextOffset > 0) params.set("offset", String(nextOffset));
    const qs = params.toString();
    return qs ? `/providers?${qs}` : "/providers";
  }

  const selectClassName = [
    "flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2",
    "text-base text-ink",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
  ].join(" ");

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Find a care provider
        </h1>
        <p className="mt-2 max-w-2xl text-base text-ink-muted">
          Search verified care providers across the UK. Use the filters below
          to narrow by area, service, or capability. Results update when you
          press Search.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          tabIndex={-1}
          id="form-error"
          className="mt-6 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form
        method="get"
        action="/providers"
        className="mt-8 rounded-lg border border-border bg-surface p-5"
        aria-label="Provider search filters"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label
              htmlFor="q"
              className="block text-sm font-medium text-ink"
            >
              Keyword
            </label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="e.g. dementia, overnight, live-in"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="near"
              className="block text-sm font-medium text-ink"
            >
              Near postcode
            </label>
            <Input
              id="near"
              name="near"
              type="text"
              defaultValue={nearRaw}
              placeholder="e.g. SW1A 1AA"
              autoComplete="postal-code"
              aria-describedby={
                postcodeGiven && !postcodeResolved
                  ? "near-hint"
                  : undefined
              }
            />
            {postcodeGiven && !postcodeResolved ? (
              <p id="near-hint" className="text-xs text-ink-muted">
                We could not find that postcode, so the radius filter was
                skipped. Check the format (e.g. SW1A 1AA) and try again.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="radius"
              className="block text-sm font-medium text-ink"
            >
              Radius
            </label>
            <select
              id="radius"
              name="radius"
              defaultValue={radiusRaw}
              className={selectClassName}
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={String(r)}>
                  {r} km
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="service"
              className="block text-sm font-medium text-ink"
            >
              Service
            </label>
            <select
              id="service"
              name="service"
              defaultValue={serviceSlug}
              className={selectClassName}
            >
              <option value="">Any service</option>
              {serviceCategories.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="capability"
              className="block text-sm font-medium text-ink"
            >
              Capability
            </label>
            <select
              id="capability"
              name="capability"
              defaultValue={capabilitySlug}
              className={selectClassName}
            >
              <option value="">Any capability</option>
              {capabilities.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-3">
            <button
              type="submit"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              Search
            </button>
            <Link
              href="/providers"
              className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              Reset
            </Link>
          </div>
        </div>
      </form>

      <section className="mt-10" aria-label="Search results">
        <h2 className="sr-only">Search results</h2>

        {results.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-base font-medium text-ink">
              No providers match your filters.
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              Try a wider radius, remove a filter, or clear your keyword.
            </p>
            <Link
              href="/providers"
              className="mt-4 inline-block text-sm font-medium text-ink underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {results.map((p) => {
              const rate = formatPounds(p.hourlyRatePence);
              const distance =
                p.distanceKm !== null
                  ? `${p.distanceKm.toFixed(1)} km away`
                  : null;
              return (
                <li
                  key={p.id}
                  className="rounded-lg border border-border bg-canvas p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold text-ink">
                        <Link
                          href={`/providers/${p.id}`}
                          className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                        >
                          {p.headline ?? "Care provider"}
                        </Link>
                      </h3>
                      <p className="mt-1 text-sm text-ink-muted">
                        {p.city ?? "Location not provided"}
                        {distance ? ` · ${distance}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {rate ? (
                        <p className="font-medium text-ink">{rate}/hr</p>
                      ) : (
                        <p className="text-ink-muted">Rate on request</p>
                      )}
                      {p.yearsExperience !== null ? (
                        <p className="text-ink-muted">
                          {p.yearsExperience} yrs experience
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {p.bio ? (
                    <p className="mt-3 line-clamp-3 text-sm text-ink-muted">
                      {p.bio}
                    </p>
                  ) : null}
                  <div className="mt-4">
                    <Link
                      href={`/providers/${p.id}`}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      View profile
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasPrev || hasNext ? (
          <nav
            className="mt-8 flex items-center justify-between gap-3"
            aria-label="Results pagination"
          >
            {hasPrev ? (
              <Link
                href={buildHref(Math.max(0, offset - PAGE_SIZE))}
                rel="prev"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                ← Previous
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
            {hasNext ? (
              <Link
                href={buildHref(offset + PAGE_SIZE)}
                rel="next"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                Next →
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
          </nav>
        ) : null}
      </section>
    </section>
  );
}
