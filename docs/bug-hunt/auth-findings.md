# Phase 1A Bug Hunt - Auth, Proxy & Server Actions

Auditor: auth-auditor
Date: 2026-04-10
Scope: `proxy.ts`, `lib/supabase/{server,client,admin,middleware}.ts`, `lib/auth/actions.ts`, `lib/audit/record-audit-event.ts`, every Server Action under `lib/**`, and the supporting migrations in `supabase/migrations/0001_profiles_and_roles.sql` and `0002_audit_log.sql`.

Severity legend: **Critical** = trivial privilege escalation or data exfiltration; **High** = reachable from the public internet with meaningful impact; **Medium** = integrity / log tampering; **Low** = latent / UX.

---

## 1. CRITICAL - Public sign-up can request any role via `raw_user_meta_data.role`

**Where:** `supabase/migrations/0001_profiles_and_roles.sql:88-118` (`handle_new_auth_user`), reachable from any client that has the public `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**What:** The `on_auth_user_created` trigger copies `raw_user_meta_data ->> 'role'` straight into `public.profiles.role`, with only an enum cast and a silent fallback to `receiver` on cast failure:

```sql
v_role := coalesce(
  (new.raw_user_meta_data ->> 'role')::public.app_role,
  'receiver'::public.app_role
);
```

There is no check that the signup came from an invite flow or from a Server Action. `signUp` in `lib/auth/actions.ts:62-88` hard-codes `role: "receiver"` on the server side, but Supabase Auth is reachable directly from a browser using the published anon key.

**Reproduction:**
```js
import { createClient } from "@supabase/supabase-js";
const sb = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
await sb.auth.signUp({
  email: "attacker@example.test",
  password: "correcthorsebatterystaple",
  options: { data: { role: "admin" } },
});
// Confirm email, sign in. profiles.role === 'admin', JWT carries app_role=admin,
// proxy.ts grants /admin/** and RLS admin policies apply.
```

The `custom_access_token_hook` then stamps `app_role=admin` onto the JWT because it reads from `profiles.role`, so the attacker is promoted end-to-end without any server action being involved.

**Suggested fix:** Do NOT trust `raw_user_meta_data.role`. Either (a) ignore it entirely and always create new rows with `'receiver'`, and rely on an explicit `admin`/`provider`-privileged promotion path (invite flows, `inviteAdmin`, a dedicated migration SQL for the super-admin), or (b) only honour `raw_user_meta_data.role` when `raw_app_meta_data.invited_by` is set, i.e. the signup came through `auth.admin.inviteUserByEmail`.

---

## 2. CRITICAL - Proxy and every Server Action trust user-writable `user_metadata.role`

**Where:** every role gate. Grep:

- `proxy.ts:63` - first-priority fallback in the proxy.
- `lib/auth/actions.ts:56, 109` - `signIn` home redirect and `inviteAdmin` role gate.
- `lib/providers/actions.ts:194` - `updateProviderProfile` gate.
- `lib/providers/profile-actions.ts:47` - `requireProvider`.
- `lib/documents/actions.ts:85` - `uploadProviderDocument` gate.
- `lib/audit/record-audit-event.ts:33` - `actor_role` stamped on every audit row.

Every call site follows this shape:

```ts
const callerRole =
  (user.app_metadata?.app_role as string | undefined) ??
  (user.user_metadata?.role as string | undefined) ??
  null;
```

**Why this is broken:**
1. `user.app_metadata.app_role` is **never populated** in this codebase. The `custom_access_token_hook` only injects `app_role` into the JWT claims payload; it does NOT write into `auth.users.raw_app_meta_data`. `supabase.auth.getUser()` reads app_metadata from `raw_app_meta_data`, which for every user in this app is `{}`. So the primary source is always undefined.
2. `user.user_metadata` is a mirror of `auth.users.raw_user_meta_data`, which **can be written by the user themselves** via `supabase.auth.updateUser({ data: { role: "admin" } })`. This is a documented, intentional Supabase behaviour.

**Reproduction (against `/admin` via the proxy):**
```js
// Sign in as a normal receiver.
const sb = createClient(URL, ANON);
await sb.auth.signInWithPassword({ email: "r@ex.test", password: "..." });
// Escalate client-side.
await sb.auth.updateUser({ data: { role: "admin" } });
// Refresh the app, proxy.ts:61-64 reads user.user_metadata.role === "admin"
// and lets the request through to /admin/** with no further check.
```

The attacker does NOT need to update `profiles.role`, so `app.current_role()` in RLS still says `receiver` and the database layer holds - but every code path that role-checks **in TypeScript** (and there are many, including `inviteAdmin`, `uploadProviderDocument`, and the whole contact/provider surface) treats them as whatever role they asked for. In particular, `inviteAdmin` (`lib/auth/actions.ts:96-136`) will let them issue fresh admin invites via the service-role key.

**Suggested fix:** Stop using `user_metadata.role` anywhere. For a server-side role check, either:
- Decode and read `app_role` from the access-token claim (the proxy already has `decodeJwtClaims`; make it the single source of truth); or
- Read `profiles.role` directly through the user-scoped client, since `profiles_self_read` allows the row.

Remove the `user_metadata.role` fallback from all six files above. The "fall back if the hook is misconfigured" comment in `proxy.ts:58-60` is actively dangerous - failing closed on a missing claim is the correct behaviour.

---

## 3. HIGH - Open redirect on `?next=` via protocol-relative URLs

**Where:** `lib/auth/actions.ts:42, 59`:

```ts
const next = (formData.get("next") as string | null) ?? null;
...
redirect(next && next.startsWith("/") ? next : homeForRole(role));
```

**What:** `startsWith("/")` also accepts `//evil.com/path`. `next/navigation`'s `redirect` sets a `Location` header verbatim; the browser resolves `//evil.com/path` against the current scheme and navigates off-site. The `next` value flows in via `?next=` on `/auth/sign-in` (the proxy writes it on role-miss in `proxy.ts:54` and `proxy.ts:80`; the sign-in page reflects it as a hidden form input at `app/(public)/auth/sign-in/page.tsx:36`).

**Reproduction:**
1. Victim clicks `https://app.example/auth/sign-in?next=//attacker.test/phish`.
2. Victim signs in.
3. `signIn` reaches `redirect("//attacker.test/phish")`, browser navigates off-origin to the phishing page while the victim thinks they are still on the app.

**Suggested fix:** Reject any `next` that does not match `^/[^/\\]`, i.e. must start with `/` but NOT `//` or `/\`. A safer predicate:
```ts
const safeNext = next && /^\/[^/\\]/.test(next) ? next : null;
```

---

## 4. HIGH - `inviteAdmin` role gate is bypassable via user_metadata escalation

**Where:** `lib/auth/actions.ts:96-136`.

**What:** This is strictly a consequence of finding #2, but it deserves its own line because it reaches the **service-role key**. Sequence:

1. Attacker signs up as receiver.
2. Attacker calls `supabase.auth.updateUser({ data: { role: "admin" } })` from the browser.
3. Attacker POSTs to the `inviteAdmin` Server Action.
4. The `callerRole !== "admin"` check on line 112 reads from `user.user_metadata.role`, which is `"admin"` - so the check passes.
5. `createAdminClient()` runs; the attacker now controls `admin.auth.admin.inviteUserByEmail(...)` with `{ role: "admin" }`, creating an out-of-band admin account that **does** have `profiles.role = admin` in the database.

The attacker now has a persistent admin foothold that survives a future fix to finding #2, because the invite was issued through the service-role key and correctly stamps the database row.

**Suggested fix:** Same as #2. Additionally, audit `auth.users` for any unexpected admin accounts before shipping the fix.

---

## 5. HIGH - `/admin` is unreachable from the proxy's URL matcher when the path contains a dot

**Where:** `proxy.ts:87-90`.

```ts
matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\..*).*)"],
```

**What:** The `.*\\..*` alternative excludes **any path that contains a period** from the proxy. That is almost certainly intended to skip static files (`logo.png`, `robots.txt`), but it is a path pattern, not an extension pattern, so `/admin/users/export.csv`, `/provider/onboarding/step.1`, `/provider/rate-2.5` and any future app route with a dot in the slug would bypass the proxy entirely and be handed to the App Router with **no role gate** at all.

**Reproduction:** Add a Next.js route like `app/(provider)/provider/plan.alpha/page.tsx`. Hit `/provider/plan.alpha` as an anonymous user - no redirect, page renders as if signed in. Any `fetch` inside that RSC hitting the user-scoped client will run as `anon` and be filtered by RLS, but the HTML shell leaks.

**Suggested fix:** Tighten the matcher to only exclude known static asset extensions, e.g.
```ts
matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|svg|gif|ico|css|js|map|txt|xml|webp|woff2?)).*)"],
```
and add a `/admin/:path*` / `/provider/:path*` matcher explicitly so role-gated prefixes are always exercised regardless of extension.

---

## 6. MEDIUM - Audit log forgery: any authenticated user can insert "system" rows

**Where:** `supabase/migrations/0002_audit_log.sql:95-104`.

```sql
create policy audit_log_insert_authenticated
  on public.audit_log
  for insert
  to authenticated
  with check (
    actor_id is null
    or actor_id = app.current_profile_id()
    or app.current_role() = 'admin'::public.app_role
  );
```

**What:** Any `authenticated` user can insert a row with `actor_id = null`, which is the sentinel the codebase uses for "system" events (see `lib/documents/promote.ts:92-101` and the comment in `lib/audit/record-audit-event.ts:15-17`). An attacker can emit arbitrary `action` / `subject_table` / `after` payloads that appear in the admin console as system events, drowning investigators in noise or forging a cover story for a real incident. The hash chain remains valid - it just validates forged content.

Because PostgREST exposes `public.audit_log` for INSERT, an attacker doesn't even need to go through `recordAuditEvent`:

```js
await sb.from("audit_log").insert({
  actor_id: null,
  action: "system.backup.complete",
  subject_table: "system",
});
```

**Suggested fix:** Require `actor_id is not null` and `= app.current_profile_id()` in the policy, and move the `actor_id IS NULL` branch to a separate `service_role`-only insert path (or a SECURITY DEFINER function the admin client can call).

---

## 7. MEDIUM - `recordAuditEvent` stamps `actor_role` from user-writable metadata

**Where:** `lib/audit/record-audit-event.ts:31-34`.

Same user_metadata fallback pattern as finding #2. Because this writes into `audit_log.actor_role`, a user who has set `user_metadata.role = "admin"` will appear in the audit trail as having acted with admin role even when `profiles.role` is `receiver`. Destroys the "who did this" signal at the exact moment you need it.

**Suggested fix:** Read `actor_role` from `profiles.role` via the user-scoped client (`profiles_self_read` allows the own row), or drop the column from the TS helper entirely and populate it inside a trigger that reads `app.current_role()` so it is always authoritative.

---

## 8. MEDIUM - `recordAuditEvent` cannot be called from system contexts

**Where:** `lib/audit/record-audit-event.ts:25-44` invoked from `lib/documents/promote.ts:95-100`.

**What:** `createServerClient()` calls `cookies()` from `next/headers`, which throws if there is no active request (e.g., a cron worker, a test harness, a background queue). `promote.ts` is explicitly documented as being called from a future Vercel Cron (`docs/pid.md` W2 / C3a). When that cron runs, `recordAuditEvent` will either throw (`cookies() is not available`) or, in the best case, insert through the `anon` role and be rejected by the `audit_log_insert_authenticated` RLS policy (`anon` is not granted). Either way the "document.promote" audit event will NOT land - a gap in the regulated-data audit trail that the whole W2 story depends on.

**Suggested fix:** Give `recordAuditEvent` an admin-client path gated by an explicit `{ system: true }` flag, and call it from `promote.ts` / `__forceRejectDocument`. Document that the system path skips the user check and the caller has authorized out-of-band. Consider writing the audit row in the same transaction as the state change so a later `move`/`update` failure also rolls back the audit entry.

---

## 9. MEDIUM - JWT fallback in proxy does not verify the token

**Where:** `proxy.ts:24-37, 66-75`.

**What:** If both metadata fallbacks miss, the proxy calls `supabase.auth.getSession()` and base64-decodes the access token with `Buffer.from(payload, 'base64')` - no signature verification, no expiry check. Today the token comes from the cookie that `getUser()` already validated a few lines earlier, so this is narrowly safe. But (a) it embeds a primitive that looks verifiable and invites future misuse, and (b) `getSession()` explicitly returns data even for expired/invalid cookies - the Supabase docs warn against trusting it on the server. A refactor that drops the earlier `getUser()` call would silently turn this into a JWT-bypass.

**Suggested fix:** Replace the manual decode with a helper that (a) re-runs `supabase.auth.getUser()` to force verification, and (b) reads `app_role` off the already-verified user context, or decodes claims only after confirming `user !== null` on the same response.

---

## 10. LOW - Cookie rotation drops the cookie `options` on `request.cookies.set`

**Where:** `lib/supabase/middleware.ts:22-30`.

```ts
setAll(cookiesToSet) {
  for (const { name, value } of cookiesToSet) {
    request.cookies.set(name, value);
  }
  response = NextResponse.next({ request });
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options);
  }
},
```

**What:** This is the pattern the Supabase SSR docs recommend, and it is *probably* fine because the `request.cookies` copy is only read by downstream code in the same request. But downstream Server Components that read `cookies().get(name)?.value` will see the refreshed value without any of its flags (`httpOnly`, `sameSite`, etc.). If any code path re-serializes those cookies onto an outgoing response without going through the `setAll` helper, the flags will be silently dropped. Worth a one-line test asserting both request and response cookies match after a rotation.

**Suggested fix:** Pass `options` on both `set` calls. The NextRequest cookie jar accepts the same `CookieOptions`.

---

## 11. LOW - `signIn` leaks raw Supabase error messages into the URL

**Where:** `lib/auth/actions.ts:51`, `lib/auth/actions.ts:84`, `lib/providers/actions.ts:119`, `lib/documents/actions.ts:282`.

Every failure path redirects with `?error=${encodeURIComponent(error.message)}`. Supabase error messages include internal details ("Invalid login credentials" is fine; "Database error saving new user: duplicate key value violates unique constraint \"...\"" is not). These strings then render into the sign-in / onboarding page. No XSS (React escapes), but it is fingerprinting surface - distinguishes "no such account" from "wrong password" and leaks migration names.

**Suggested fix:** Map error messages to a small enum of stable codes (`invalid_credentials`, `rate_limited`, `email_taken`, `unknown`) and redirect with the code instead of the raw message.

---

## 12. LOW - `signOut` does not clear the server-side session before redirect

**Where:** `lib/auth/actions.ts:90-94`.

```ts
export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
```

`supabase.auth.signOut()` with the SSR client writes expired cookies via the `setAll` callback. But the return value is not checked, and `signOut` does not call `scope: 'global'`, so other sessions for the same user remain active. For a regulated app this should be `signOut({ scope: 'global' })` and the result should be checked - a failure here leaves the user "signed out" in the UI with a still-live token in the cookie jar.

**Suggested fix:** `await supabase.auth.signOut({ scope: "global" });` and redirect with an error param if it returns an error.

---

## Count

| Severity  | Count |
|-----------|-------|
| Critical  | 2     |
| High      | 3     |
| Medium    | 4     |
| Low       | 3     |

Fix order recommendation: #1 + #2 must ship before anything else - they are the foundation every other check is built on. #3, #4, #5 close the remaining reachable-from-the-public-internet paths. #6 - #9 restore audit-trail integrity. #10 - #12 are polish.
