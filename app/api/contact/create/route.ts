import { NextResponse } from "next/server";

import { sendContactRequest } from "@/lib/contact/actions";
import { ContactValidationError } from "@/lib/contact/types";

/**
 * C8 contact-request creation boundary.
 *
 * Server Actions are not HTTP route handlers and so cannot naturally host
 * `checkBotId()` (which inspects the incoming HTTP request) or a per-IP
 * rate limit (which needs the forwarded client address). The PID lists
 * BotID and per-IP + per-receiver rate limiting as launch-blocking C8
 * controls (docs/pid.md line 403); we implement those here and then
 * delegate to the validated server logic in `lib/contact/actions.ts`.
 *
 * Order of operations (any step may short-circuit with a redirect back
 * to the form):
 *   1. Vercel BotID check (soft-fallback in dev/preview, hard-fail in
 *      production - matches the C7a search gate).
 *   2. Per-IP bucket (in-memory, 10 requests per rolling hour per IP).
 *   3. Parse FormData and call `sendContactRequest` (which enforces
 *      auth, role, RLS, per-profile rate limit via trigger, and sends
 *      the provider email).
 *   4. 303 redirect to `/receiver/contacts/<id>` on success, or back to
 *      `/receiver/contacts/new?provider=...&error=...` on any failure.
 *
 * We do NOT return JSON here: the caller is an HTML `<form action>`, so
 * the response shape is a same-origin browser redirect.
 *
 * See contact-findings C-3 (BotID) and C-4 (per-IP rate limit).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------- BotID

type BotVerdict = { isBot: boolean };

/**
 * Dynamic import of `botid/server` with a dev/preview soft-fallback.
 * Mirrors `app/api/providers/search/route.ts#runBotCheck` so the two
 * gates stay consistent. In production (`VERCEL_ENV === 'production'`)
 * an import or runtime failure is fatal: we would rather deny legitimate
 * traffic for a few minutes than silently disengage the bot gate.
 */
async function runBotCheck(): Promise<BotVerdict> {
  const isProd = process.env.VERCEL_ENV === "production";
  try {
    const mod = (await import("botid/server")) as {
      checkBotId?: () => Promise<BotVerdict>;
    };
    if (typeof mod.checkBotId !== "function") {
      if (isProd) {
        throw new Error("botid/server did not export checkBotId");
      }
      return { isBot: false };
    }
    const verdict = await mod.checkBotId();
    return { isBot: Boolean(verdict.isBot) };
  } catch (err) {
    if (isProd) {
      // Fail-closed in production. The caller turns this into a 403.
      throw err;
    }
    return { isBot: false };
  }
}

// ---------------------------------------------------------------- per-IP bucket

const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const IP_MAX = 10;

type Bucket = {
  windowStart: number;
  count: number;
};

/**
 * Process-local per-IP bucket. This is intentionally minimal: on Vercel
 * Fluid Compute a single function instance can be reused across requests,
 * so the Map persists long enough to catch a burst from one IP. A
 * distributed counter (DB or KV) is the correct long-term home and
 * sql-fixer's migration 0009 adds the per-profile counter; this in-memory
 * guard layers the per-IP dimension that the PID requires at the C8
 * boundary. See contact-findings C-4.
 */
const ipBuckets = new Map<string, Bucket>();

function clientIp(headers: Headers): string {
  // `x-vercel-forwarded-for` is Vercel's trusted header; `x-forwarded-for`
  // is the spec fallback when running behind a generic proxy (e.g. local
  // dev through `next dev`). Take the first entry if comma-delimited.
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first;
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function checkIpBucket(ip: string): { limited: boolean } {
  const now = Date.now();
  const existing = ipBuckets.get(ip);
  if (!existing || now - existing.windowStart >= IP_WINDOW_MS) {
    ipBuckets.set(ip, { windowStart: now, count: 1 });
    return { limited: false };
  }
  existing.count += 1;
  if (existing.count > IP_MAX) {
    return { limited: true };
  }
  return { limited: false };
}

// ---------------------------------------------------------------- redirects

function errorRedirect(
  origin: string,
  providerId: string,
  message: string,
): NextResponse {
  const base = providerId
    ? `/receiver/contacts/new?provider=${encodeURIComponent(providerId)}`
    : "/receiver/contacts/new";
  const sep = base.includes("?") ? "&" : "?";
  return NextResponse.redirect(
    `${origin}${base}${sep}error=${encodeURIComponent(message)}`,
    { status: 303 },
  );
}

function successRedirect(
  origin: string,
  contactRequestId: string,
): NextResponse {
  return NextResponse.redirect(
    `${origin}/receiver/contacts/${contactRequestId}`,
    { status: 303 },
  );
}

function humaniseCode(code: string): string {
  switch (code) {
    case "sign_in_required":
      return "Please sign in to continue.";
    case "role_forbidden":
      return "Your account cannot perform this action.";
    case "provider_not_available":
      return "That provider is not accepting contact requests right now.";
    case "rate_limited":
      return "You are sending messages too quickly. Please wait and try again.";
    case "invalid_subject":
      return "Subject must be between 3 and 120 characters.";
    case "invalid_body":
      return "Message must be between 10 and 2000 characters.";
    case "missing_subject":
      return "Please enter a subject.";
    case "missing_body":
      return "Please enter a message.";
    case "missing_provider_id":
      return "A provider must be selected.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---------------------------------------------------------------- handler

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const providerIdRaw = formData.get("provider_id");
  const providerId =
    typeof providerIdRaw === "string" ? providerIdRaw.trim() : "";

  // 1. BotID gate
  try {
    const verdict = await runBotCheck();
    if (verdict.isBot) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 2. Per-IP rate limit
  const ip = clientIp(request.headers);
  const ipCheck = checkIpBucket(ip);
  if (ipCheck.limited) {
    return errorRedirect(
      origin,
      providerId,
      "Too many contact requests from your network. Please wait an hour and try again.",
    );
  }

  // 3. Delegate to the validated server logic
  try {
    const { contactRequestId } = await sendContactRequest(formData);
    return successRedirect(origin, contactRequestId);
  } catch (err) {
    if (err instanceof ContactValidationError) {
      return errorRedirect(origin, providerId, humaniseCode(err.code));
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[contact.create] unexpected error", message);
    return errorRedirect(
      origin,
      providerId,
      "Something went wrong. Please try again.",
    );
  }
}
