import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  searchProviders,
  resolveSearchLocation,
  type ProviderSearchFilters,
} from "@/lib/search/provider-search";
import { getFilterOptions } from "@/lib/search/filter-options";

/*
 * C7a+C7b public provider directory (stories 18, 19). Lives under `(public)`,
 * so the surface uses the neutral semantic palette only.
 *
 * Server Component. The filter form posts via plain HTML GET so the URL is
 * the entire source of truth and results are shareable/bookmarkable. Advanced
 * filters (gender, certifications, capabilities, services, rate range) are
 * rendered in a collapsible details element below the primary search controls.
 */

export const metadata = {
  title: "Find a care provider - MyCareProvider",
  description:
    "Search verified care providers across the UK. Filter by area, service, capability, certifications, gender, and rate.",
};

const PAGE_SIZE = 20;
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
const DEFAULT_RADIUS = "25";

type SearchParams = {
  q?: string;
  near?: string;
  radius?: string;
  service?: string | string[];
  capability?: string | string[];
  certification?: string | string[];
  gender?: string;
  rate_min?: string;
  rate_max?: string;
  offset?: string;
  error?: string;
};

function parseOffset(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parsePence(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  // Input is in pounds, convert to pence
  return Math.round(n * 100);
}

function formatPounds(pence: number | null): string | null {
  if (pence === null) return null;
  return `\u00A3${(pence / 100).toFixed(2)}`;
}

function formatGender(gender: string | null): string | null {
  if (!gender) return null;
  const labels: Record<string, string> = {
    female: "Female",
    male: "Male",
    non_binary: "Non-binary",
  };
  return labels[gender] ?? null;
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
  const serviceSlugs = toArray(sp.service);
  const capabilitySlugs = toArray(sp.capability);
  const certificationSlugs = toArray(sp.certification);
  const genderFilter = sp.gender ?? "";
  const rateMinRaw = sp.rate_min ?? "";
  const rateMaxRaw = sp.rate_max ?? "";
  const offset = parseOffset(sp.offset);
  const error = sp.error;

  const [filterOptions, near] = await Promise.all([
    getFilterOptions(),
    resolveSearchLocation(nearRaw, radiusRaw),
  ]);

  const postcodeGiven = nearRaw.trim().length > 0;
  const postcodeResolved = near !== undefined;

  const hasAdvancedFilters =
    certificationSlugs.length > 0 ||
    genderFilter.length > 0 ||
    rateMinRaw.length > 0 ||
    rateMaxRaw.length > 0 ||
    serviceSlugs.length > 1 ||
    capabilitySlugs.length > 1;

  const filters: ProviderSearchFilters = {
    query: q.length > 0 ? q : undefined,
    near,
    serviceSlugs: serviceSlugs.length > 0 ? serviceSlugs : undefined,
    capabilitySlugs: capabilitySlugs.length > 0 ? capabilitySlugs : undefined,
    certificationSlugs: certificationSlugs.length > 0 ? certificationSlugs : undefined,
    gender: genderFilter.length > 0 ? genderFilter : undefined,
    rateMinPence: parsePence(rateMinRaw),
    rateMaxPence: parsePence(rateMaxRaw),
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
    for (const s of serviceSlugs) params.append("service", s);
    for (const c of capabilitySlugs) params.append("capability", c);
    for (const c of certificationSlugs) params.append("certification", c);
    if (genderFilter) params.set("gender", genderFilter);
    if (rateMinRaw) params.set("rate_min", rateMinRaw);
    if (rateMaxRaw) params.set("rate_max", rateMaxRaw);
    if (nextOffset > 0) params.set("offset", String(nextOffset));
    const qs = params.toString();
    return qs ? `/providers?${qs}` : "/providers";
  }

  const selectClassName = [
    "flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2",
    "text-base text-ink",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
  ].join(" ");

  const checkboxLabelClassName =
    "flex items-center gap-2 text-sm text-ink cursor-pointer";

  const checkboxClassName = [
    "h-4 w-4 rounded border-border text-ink",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
  ].join(" ");

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          Find a care provider
        </h1>
        <p className="mt-2 max-w-2xl text-base text-ink-muted">
          Search verified care providers across the UK. Use the filters below
          to narrow by area, service, capability, certifications, and more.
          Results update when you press Search.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          tabIndex={-1}
          id="form-error"
          className="mt-6 rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form
        method="get"
        action="/providers"
        className="mt-8 rounded-2xl border-2 border-border bg-surface p-5"
        aria-label="Provider search filters"
        noValidate
      >
        {/* Primary filters */}
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
        </div>

        {/* Advanced filters - collapsible */}
        <details
          className="mt-5 rounded-xl border border-border bg-canvas p-4"
          open={hasAdvancedFilters || undefined}
        >
          <summary className="cursor-pointer text-sm font-medium text-ink hover:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
            Advanced filters
          </summary>

          <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Gender */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">Gender</legend>
              <select
                name="gender"
                defaultValue={genderFilter}
                className={selectClassName}
                aria-label="Filter by gender"
              >
                <option value="">Any gender</option>
                {filterOptions.genders.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.name}
                  </option>
                ))}
              </select>
            </fieldset>

            {/* Rate range */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">
                Hourly rate range
              </legend>
              <div className="flex items-center gap-2">
                <label htmlFor="rate_min" className="sr-only">
                  Minimum rate in pounds
                </label>
                <Input
                  id="rate_min"
                  name="rate_min"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={rateMinRaw}
                  placeholder="Min"
                  aria-label="Minimum hourly rate in pounds"
                />
                <span className="text-sm text-ink-muted" aria-hidden="true">
                  to
                </span>
                <label htmlFor="rate_max" className="sr-only">
                  Maximum rate in pounds
                </label>
                <Input
                  id="rate_max"
                  name="rate_max"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={rateMaxRaw}
                  placeholder="Max"
                  aria-label="Maximum hourly rate in pounds"
                />
              </div>
            </fieldset>

            {/* Services - checkboxes */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">Services</legend>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {filterOptions.services.map((s) => (
                  <label key={s.slug} className={checkboxLabelClassName}>
                    <input
                      type="checkbox"
                      name="service"
                      value={s.slug}
                      defaultChecked={serviceSlugs.includes(s.slug)}
                      className={checkboxClassName}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Capabilities - checkboxes */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">
                Capabilities
              </legend>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {filterOptions.capabilities.map((c) => (
                  <label key={c.slug} className={checkboxLabelClassName}>
                    <input
                      type="checkbox"
                      name="capability"
                      value={c.slug}
                      defaultChecked={capabilitySlugs.includes(c.slug)}
                      className={checkboxClassName}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Certifications - checkboxes */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">
                Certifications
              </legend>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {filterOptions.certifications.map((c) => (
                  <label key={c.slug} className={checkboxLabelClassName}>
                    <input
                      type="checkbox"
                      name="certification"
                      value={c.slug}
                      defaultChecked={certificationSlugs.includes(c.slug)}
                      className={checkboxClassName}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </details>

        {/* Action buttons */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-base font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            Search
          </button>
          <Link
            href="/providers"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="mt-10" aria-label="Search results">
        <h2 className="sr-only">Search results</h2>

        {results.length === 0 ? (
          <div className="rounded-2xl border-2 border-border bg-surface p-8 text-center">
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
              const genderLabel = formatGender(p.gender);
              return (
                <li
                  key={p.id}
                  className="rounded-2xl border-2 border-border bg-canvas p-5"
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
                        {genderLabel ? ` · ${genderLabel}` : ""}
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
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
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
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
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
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
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
