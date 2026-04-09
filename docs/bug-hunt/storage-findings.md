# Phase 1a Bug Hunt - Storage, Documents, and Search (Task #3)

Auditor: storage-auditor
Scope: `lib/documents/**`, `lib/providers/**`, `lib/search/**`, `lib/geo/**`,
`app/api/providers/search/route.ts`, `app/(public)/providers/**`, and
migrations `0004_provider_onboarding.sql`, `0005_provider_services_capabilities.sql`,
`0006_provider_search.sql`.

Report only - no fixes applied.

Severity legend: CRITICAL / HIGH / MEDIUM / LOW / INFO.

Summary counts: CRITICAL 2, HIGH 5, MEDIUM 6, LOW 2.

---

## CRITICAL

### C-1. Personal home postcode silently published to anon via `service_postcode` fallback
- File: `lib/providers/actions.ts:213, 258-276`
- Severity: CRITICAL (PII leak to unauthenticated callers)
- Summary: `updateProviderProfile` computes
  `postcodeForGeocoding = servicePostcode ?? postcode` and then persists that
  value as `service_postcode`. The anon column grant on `provider_profiles`
  added in `0006_provider_search.sql:88-89` includes `service_postcode`,
  `latitude`, and `longitude`. When a provider fills in a personal `postcode`
  (intended as private address data, not publicly discoverable) but leaves
  `service_postcode` blank, the Server Action writes their personal postcode
  into the public column, and the geocoder pins lat/lng to that location. The
  `/api/providers/search` JSON payload and the `(public)/providers/[id]` page
  then return those values to any anon client.
- Repro:
  1. Sign up as a provider, complete onboarding with `postcode=SW1A 1AA` and
     leave `service_postcode` empty.
  2. Admin marks the profile `verified_at`.
  3. `GET /api/providers/search?q=...` returns `service_postcode: "SW1A 1AA"`
     plus `latitude` / `longitude` pinned to the provider's home.
- Impact: The PID (`docs/pid.md` "Core domain model" / RLS-safety) explicitly
  states that `phone`, `date_of_birth`, and address lines must not leak to the
  directory. Personal `postcode` is the 6-character home address; exposing it
  plus exact coordinates defeats the whole narrowed-grant design of 0004.
- Suggested fix: Do not fall back to `postcode` when `service_postcode` is
  blank. If the provider has not set a service postcode, null out
  `service_postcode`, `latitude`, `longitude`, `geocoded_at` so they simply
  don't appear in directory search. Alternatively, round the coordinates to
  ~1km and drop the full postcode from the anon grant.

### C-2. `promoteQuarantinedDocument` flips `status=available` with zero virus-scan gate
- File: `lib/documents/promote.ts:29-103`
- Severity: CRITICAL (task brief explicitly asks for this: "missing virus-scan
  gate before status=available")
- Summary: The promote function moves the object from `quarantine/` to
  `clean/` and flips `documents.status` to `available` without calling any
  scanner. The JSDoc notes this as a stub "TODO (C3a / W2)", and the real
  scanning pipeline is deferred. Meanwhile the function is fully exported,
  takes an arbitrary `documentId`, and uses the admin (service-role) client so
  RLS does not apply. Any server-side caller can promote an infected file.
  There is also no authorization check inside the function - the file says
  "every caller must have already authorized the operation out-of-band", but
  nothing structurally enforces that.
- Repro: Any server-side import of `promoteQuarantinedDocument(documentId)`
  with a real document id will move the bytes and flip the row to
  `available`, regardless of content.
- Suggested fix: Block shipping the promote function into any reachable code
  path (cron, admin tool, API route) until the scanner integration lands.
  Gate on a `scan_result` column or a separate `document_scans` table. Add a
  `require(scan.status === 'clean')` precondition. Do not grant EXECUTE on
  any wrapper that reaches this code from HTTP.

---

## HIGH

### H-1. MIME allow-list trusts client-declared `file.type`
- File: `lib/documents/actions.ts:72, 100-101, 140`, `lib/documents/mime.ts`
- Severity: HIGH
- Summary: `assertAllowedUpload({ mimeType: file.type, ... })` uses
  `file.type`, which is the `Content-Type` header chosen by the uploading
  client. An attacker can upload an arbitrary binary (e.g. an `.exe`, `.zip`,
  HTML with inline script) while declaring `Content-Type: application/pdf`
  and bypass the allow list entirely. The declared MIME is then persisted
  into `documents.mime_type` and used as the bucket object's `contentType`,
  so downstream consumers will render it as if it were a PDF.
- Repro: `curl -F 'kind=dbs' -F 'title=x' -F 'file=@malware.exe;type=application/pdf' ...`
- Impact: Combined with C-2, any provider-linked document kept at
  `status=quarantined` can be later promoted to `clean/` with an arbitrary
  payload masquerading as a PDF.
- Suggested fix: Sniff magic bytes server-side (e.g. `file-type` npm module
  or a small allow-list of signatures) and reject on mismatch. Do not trust
  the client-declared MIME; set `contentType` from the sniffed result.

### H-2. Role guard in Server Actions falls back to user-writable `user_metadata.role`
- Files: `lib/documents/actions.ts:83-90`, `lib/providers/actions.ts:192-199`,
  `lib/providers/profile-actions.ts:45-55`
- Severity: HIGH
- Summary: Every provider-only Server Action computes:
  ```ts
  const callerRole =
    (user.app_metadata?.app_role as string | undefined) ??
    (user.user_metadata?.role as string | undefined) ??
    null;
  ```
  The `custom_access_token_hook` in `0001_profiles_and_roles.sql:140-151`
  stamps `claims.app_role` from `public.profiles.role`, NOT into
  `user.app_metadata.app_role`. In practice `user.app_metadata?.app_role` is
  almost always `undefined`, so the fallback branch (`user_metadata.role`) is
  what runs. `user_metadata` is user-writable via `supabase.auth.updateUser`,
  so any signed-in receiver can self-promote to `role: "provider"` and pass
  the TS guard. RLS is still the real enforcement boundary, so direct SQL
  writes are mostly contained, BUT:
    - In `lib/documents/actions.ts:105-123`, when the user-scoped upload
      fails, the code explicitly escalates to the admin (service-role)
      client, "only reachable after the owner boundary has been validated
      server-side". That server-side validation is exactly the broken role
      check, so a non-provider can take the admin fallback path.
    - It also weakens every audit trail by marking non-provider writes as if
      a provider issued them.
- Repro: Sign in as a receiver. Call
  `supabase.auth.updateUser({ data: { role: "provider" } })` client-side.
  Then hit any `uploadProviderDocument` endpoint; the TS role check passes.
- Suggested fix: Drop the `user_metadata.role` fallback entirely. Read from
  `app.current_role()` via a short `select app.current_role()` RPC, or from
  the JWT claim directly; do not trust `user_metadata` for any authorization
  decision.

### H-3. `public.search_providers` radius math is unchecked at the DB layer
- File: `supabase/migrations/0006_provider_search.sql:94-218`
- Severity: HIGH
- Summary: `radius_km` is declared `int`, and the body computes
  `radius_km * 1000` inside `earth_box(...)` and `earth_distance(...) <= radius_km * 1000`.
  The TS clamp `MAX_RADIUS_KM = 200` lives in
  `lib/search/provider-search.ts:62, 87`, but the SQL function is granted to
  `anon, authenticated` and is also re-exported through
  `public.search_providers`. PostgREST exposes `public` schema, so an
  unauthenticated caller can hit
  `POST /rest/v1/rpc/search_providers` directly with
  `{"radius_km": 2147483}` and bypass the TS clamp. `radius_km * 1000` then
  overflows Postgres `int` at ~2,147,484, producing an
  `integer out of range` error that returns as a 500. For values below that,
  the function happily runs a global scan with an unbounded earth_box.
- Repro: `curl -X POST ${SUPABASE_URL}/rest/v1/rpc/search_providers
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json"
  -d '{"query":null,"near_lat":51.5,"near_lng":-0.1,"radius_km":2000000,
       "service_slug":null,"capability_slug":null,
       "limit_count":100,"offset_count":0}'`
- Suggested fix: Cap `radius_km` in the SQL body with `least(coalesce(radius_km, 25), 200)`
  (mirroring the `limit_count` pattern already in the same function). Same
  treatment for `offset_count` to block pagination walks with offset = 2^31.

### H-4. Cert linkage does not require an `available` document status
- File: `lib/providers/profile-actions.ts:81-113, 273-275, 394-396`
- Severity: HIGH
- Summary: `assertDocumentOwnership` only checks `uploaded_by`, `kind`, and
  `deleted_at is null`. It does not check `status`. A provider can link a
  `quarantined` (un-scanned) or even a `rejected` document to a
  `provider_certifications` row. The public viewer at
  `(public)/providers/[id]/page.tsx` does not currently show the linked file,
  but any later C5 admin flow or receiver-side viewer that loads the linked
  document will treat rejected/dirty files as legitimate proof of
  certification. Combined with H-1 it is easy to upload an arbitrary blob,
  never get it promoted, and still have it appear as the "certificate" for
  a claimed NVQ Level 3.
- Suggested fix: In `assertDocumentOwnership`, add `and status = 'available'`.
  Re-check on `updateProviderCertification` too.

### H-5. Promote rollback is best-effort and can desync row from object
- File: `lib/documents/promote.ts:74-90`
- Severity: HIGH
- Summary: If the storage move succeeds but the `documents` UPDATE fails, the
  rollback is `admin.storage.move(cleanPath, currentPath).catch(() => {})`.
  On a transient storage outage the rollback can silently fail and leave the
  row pointing at `storage_path=quarantine/...` while the actual object lives
  at `clean/...`. Next read (via `storage_bucket, storage_path`) returns 404;
  next promote attempt sees status still `quarantined`, tries the move
  again, fails with "object not found", and surfaces an opaque error that
  admins will need to reconcile by hand. There is also no audit event
  written for the failure leg.
- Suggested fix: Write the audit event for the rollback attempt, return a
  structured error, and add a reconciliation query that scans for
  `documents` whose object does not exist at the expected path.

---

## MEDIUM

### M-1. `provider_profiles.latitude`/`longitude` is exact coordinates, granted to anon
- File: `supabase/migrations/0006_provider_search.sql:88-89`
- Severity: MEDIUM (PII / privacy)
- Summary: The anon column grant exposes `latitude, longitude` at full
  precision (double). Even absent C-1, this is the exact geocode of whatever
  postcode the provider typed, which for sole traders is usually their home.
  `/api/providers/search` returns these raw in the JSON payload
  (`lib/search/provider-search.ts:123-135`). Scrapers can trivially plot
  every provider's residence.
- Suggested fix: Either (a) round to a coarse grid (2-3 decimals ≈ 1km) in
  the SQL projection, or (b) withhold lat/lng from the anon grant and return
  only `distance_km` (which the RPC already computes server-side).

### M-2. Search `query` is interpolated into ILIKE without escaping `%` / `_`
- File: `supabase/migrations/0006_provider_search.sql:151-157`
- Severity: MEDIUM (not SQL injection; input is parametrized)
- Summary: User-supplied `query` is concatenated into
  `ilike '%' || query || '%'`. An attacker can submit `%` to force a
  sequential scan against every verified row across headline/bio/city, or
  `\` to break parsing depending on client escape behaviour. This is a
  denial-of-wallet footgun rather than data exfil, but combined with BotID
  being opt-in (and currently soft-failing in `app/api/providers/search/route.ts:35-49`)
  it is a cheap CPU sink.
- Suggested fix: `replace(replace(replace(query, '\', '\\'), '%', '\%'), '_', '\_')`
  before concat, or switch to `websearch_to_tsquery` + a generated
  `tsvector` column. Also, turn the BotID soft-fail into a hard-fail before
  launch (already flagged in the route handler's TODO).

### M-3. BotID is soft-failing and lets scrapers through silently
- File: `app/api/providers/search/route.ts:35-72`
- Severity: MEDIUM
- Summary: `runBotCheck` wraps the `botid/server` import in a `try/catch` and
  returns `{isBot: false}` on any import failure ("dev/preview fallback").
  Preview and production both read from the same code path, so a
  mis-configured `botid/server` (missing package, missing key, wrong
  runtime) silently disables the gate. The PID pins BotID as launch-blocking
  (`docs/pid.md:375, 384`). There is no runtime invariant ("must succeed in
  prod") and no observability signal.
- Suggested fix: When `process.env.VERCEL_ENV === 'production'` the import
  failure branch should `throw` or return `{isBot: true}` to fail closed.
  Log every soft-fail with a structured warning so an on-call rotation can
  see it.

### M-4. `public.search_providers` wrapper double-grants with no extra logic
- File: `supabase/migrations/0006_provider_search.sql:231-272`
- Severity: MEDIUM (design smell, not a direct bug)
- Summary: The `public.search_providers` wrapper just forwards args to
  `app.search_providers`, but duplicates the full argument list. Any future
  signature change (e.g. adding a `min_hourly_rate_pence` param) must be
  kept in sync across two function definitions; forgetting to update the
  wrapper will silently break search or, worse, let the old signature run
  against new data. Related: both copies hard-code the `limit_count` cap
  with `least(...)`, but neither caps `offset_count` (see H-3 for the
  radius half of this problem).
- Suggested fix: Consider dropping the wrapper and adding `app` to
  PostgREST's exposed schemas, or centralise the argument list in a single
  view/rowtype so future additions only need one touch-point. At minimum,
  add a pgTAP check that the two signatures match.

### M-5. `documents` row can be inserted against `provider_id` for someone who is not yet a provider
- File: `supabase/migrations/0004_provider_onboarding.sql:304-313`
- Severity: MEDIUM
- Summary: `documents_owner_insert` allows
  `provider_id is null or provider_id = app.current_profile_id()`, but
  nothing checks that the caller actually has a `provider_profiles` row (or
  that their role is `provider`). The FK on `provider_id` will reject if
  there is no matching row, but a receiver who has somehow created a
  `provider_profiles` row (via the owner-INSERT policy in this same
  migration, which has no role check - see the migration's own design note
  #3 flagging this for review) can upload provider documents. The chain
  `role=receiver -> insert into provider_profiles -> upload document under
  provider_id` is the path.
- Suggested fix: Gate `provider_profiles_owner_insert` on
  `app.current_role() in ('provider', 'provider_company')`.

### M-6. `safeFilename` truncates after cleaning, may collide on long UTF-8 names
- File: `lib/documents/actions.ts:30-39`
- Severity: LOW-MEDIUM
- Summary: The filename is cleaned then `.slice(0, 120)`. Cleaning converts
  all non-ASCII to `_`, so long CJK or emoji filenames collapse to a string
  of underscores and truncate to the same 120-char value. Combined with the
  `crypto.randomUUID()` prefix the object name stays unique, so this is not
  a collision risk - but the persisted filename loses all user-facing
  information. No security impact; flagging as a correctness nit.
- Suggested fix: Preserve a sanitized UTF-8 base (e.g. transliterate or
  percent-encode) instead of the greedy `[^a-zA-Z0-9._-]+` replacement.

---

## LOW

### L-1. `deleted_at` check missing from provider viewer page
- File: `app/(public)/providers/[id]/page.tsx:113-120`
- Severity: LOW (transitively enforced by RLS)
- Summary: The SELECT filters `eq("id", id).not("verified_at", "is", null)`
  but does not reference `deleted_at`. The header comment even calls this
  out as intentional (anon has no column grant on `deleted_at`, so
  referencing it would 403 the query). Soft-delete visibility is left to
  the `provider_profiles_public_read` RLS policy, which does check
  `deleted_at is null`. This works today, but it is a single-RLS-policy-wide
  load-bearing invariant - a future refactor that loosens the public_read
  policy would silently expose soft-deleted providers through this page.
- Suggested fix: Add a defensive pgTAP test that asserts
  `public.provider_profiles` cannot return a row where `deleted_at is not null`
  when queried as `anon`, regardless of policy wording.

### L-2. Rate limiter, abuse controls, and postcode geocoder have no upstream error budget
- File: `lib/geo/postcode.ts:53-81`, `lib/search/provider-search.ts`
- Severity: LOW
- Summary: `geocodePostcode` hits `api.postcodes.io` with
  `cache: "force-cache"` + 7-day revalidate, but there is no circuit
  breaker, timeout, or retry budget. An outage at postcodes.io freezes every
  `updateProviderProfile` save and every `/api/providers/search?near=` call
  for the duration of the cache miss window. Not a bug today; worth
  flagging ahead of C7a launch.
- Suggested fix: Add a fetch timeout (e.g. `AbortSignal.timeout(2000)`) and
  on failure treat the near-query as "no radius filter" rather than
  throwing a 500.

---

## INFO / Non-findings (checked, no bug)

- `date_of_birth`, `phone`, `address_line1`, `address_line2`, `postcode`,
  `geocoded_at` are correctly **withheld** from the anon grant in 0004 + 0006.
  Confirmed against the PID requirement. (See C-1 for the subtle
  `service_postcode` exception.)
- `app.search_providers()` is STABLE SECURITY INVOKER and filters
  `verified_at is not null`; RLS on `provider_profiles` re-asserts
  `deleted_at is null`. Draft / soft-deleted rows do not leak through the
  function body itself.
- `search_providers` uses bound parameters for `query`, `service_slug`,
  `capability_slug`. No SQL injection surface.
- `tg_documents_guard` correctly freezes every non-`deleted_at` column on
  the owner-UPDATE path.
- `provider_services` / `provider_capabilities` composite-PK tables have no
  authenticated UPDATE policy, so column-guard-trigger bypass via
  `UPDATE ... SET provider_id = other_user` is not reachable.
- `storage.foldername(name)[2]::uuid = auth.uid()` in
  `provider_docs_owner_insert` correctly scopes uploads to the caller's UID.
  Path traversal via `../` is neutralised by `safeFilename` stripping
  separators before the storage path is constructed.
- `tg_documents_create_verification` is `security definer` and sets
  `search_path = public, app`, which is correct.

---

## Final counts

- CRITICAL: 2
- HIGH: 5
- MEDIUM: 6
- LOW: 2
- INFO (non-findings): 7
