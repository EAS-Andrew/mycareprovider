import { NextResponse } from "next/server";

import {
  resolveSearchLocation,
  searchProviders,
  type ProviderSearchResult,
} from "@/lib/search/provider-search";

/**
 * C7a public search endpoint. Backs the public provider directory and is
 * also usable directly as JSON (e.g. by the later C7b advanced-filter
 * client page). Unauthenticated - RLS on `provider_profiles` and the
 * `app.search_providers` RPC body limit results to verified, non-soft-
 * deleted rows, and the route handler itself never touches the admin
 * client.
 *
 * Abuse controls: Vercel BotID gate at the top of every GET. BotID is a
 * launch-blocking requirement per docs/pid.md C7a / C8 Abuse controls,
 * not a nice-to-have. See TODO below for the production rollout gate.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dynamic import of `botid/server`. M-3: in production the gate fails
 * closed - if the import, export lookup, or `checkBotId()` call throws,
 * the request is treated as a bot. In dev/preview we keep the soft-fail
 * so feature work is not blocked, but every fallback is logged with a
 * structured warning so an on-call rotation can spot silent disables.
 */
async function runBotCheck(): Promise<{ isBot: boolean }> {
  const isProd = process.env.VERCEL_ENV === "production";
  try {
    const mod = (await import("botid/server")) as {
      checkBotId?: () => Promise<{ isBot: boolean }>;
    };
    if (typeof mod.checkBotId !== "function") {
      if (isProd) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "botid.missing_export",
            route: "/api/providers/search",
            message: "checkBotId export missing in production",
          }),
        );
        return { isBot: true };
      }
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "botid.missing_export",
          route: "/api/providers/search",
          message: "checkBotId export missing in dev/preview, soft-fail",
        }),
      );
      return { isBot: false };
    }
    const verdict = await mod.checkBotId();
    return { isBot: Boolean(verdict.isBot) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isProd) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "botid.import_failed",
          route: "/api/providers/search",
          message,
        }),
      );
      return { isBot: true };
    }
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "botid.import_failed",
        route: "/api/providers/search",
        message,
      }),
    );
    return { isBot: false };
  }
}

function parseLimit(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function parseOffset(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export async function GET(request: Request): Promise<Response> {
  const verdict = await runBotCheck();
  if (verdict.isBot) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const nearRaw = url.searchParams.get("near") ?? undefined;
  const radiusRaw = url.searchParams.get("radius") ?? undefined;
  const serviceSlugs = url.searchParams.getAll("service").filter(Boolean);
  const capabilitySlugs = url.searchParams.getAll("capability").filter(Boolean);
  const certificationSlugs = url.searchParams.getAll("certification").filter(Boolean);
  const gender = url.searchParams.get("gender") ?? undefined;
  const rateMinRaw = url.searchParams.get("rate_min");
  const rateMaxRaw = url.searchParams.get("rate_max");
  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = parseOffset(url.searchParams.get("offset"));

  const near = await resolveSearchLocation(nearRaw, radiusRaw);

  const rateMinPence = rateMinRaw ? Math.round(Number(rateMinRaw) * 100) : undefined;
  const rateMaxPence = rateMaxRaw ? Math.round(Number(rateMaxRaw) * 100) : undefined;

  let results: ProviderSearchResult[];
  try {
    results = await searchProviders({
      query: q,
      near,
      serviceSlugs: serviceSlugs.length > 0 ? serviceSlugs : undefined,
      capabilitySlugs: capabilitySlugs.length > 0 ? capabilitySlugs : undefined,
      certificationSlugs: certificationSlugs.length > 0 ? certificationSlugs : undefined,
      gender,
      rateMinPence: Number.isFinite(rateMinPence) ? rateMinPence : undefined,
      rateMaxPence: Number.isFinite(rateMaxPence) ? rateMaxPence : undefined,
      limit,
      offset,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ results });
}
