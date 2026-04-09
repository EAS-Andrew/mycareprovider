# RLS audit findings - Phase 1a (C1/C2/C3a/C6a/C7a/C8/C9a)

Auditor: rls-auditor
Scope: `supabase/migrations/0001`-`0008` and `supabase/tests/rls/*`
Severity scale: critical / high / medium / low. Reproductions target a real, logged-in attacker using the Supabase JS client with the anon key unless otherwise noted.

---

## 1. CRITICAL - Privilege escalation via sign-up `raw_user_meta_data.role`

**File/line:** `supabase/migrations/0001_profiles_and_roles.sql:88-118` (`handle_new_auth_user`)
Also confirmed by test `supabase/tests/rls/profiles.test.sql:34-38` which explicitly asserts the trigger honours `raw_user_meta_data.role = 'admin'`.

**Bug:** The auto-provision trigger on `auth.users` reads the new user's role directly from `raw_user_meta_data ->> 'role'` and inserts it into `public.profiles` with no allow-list. Any client can reach `auth.signUp` with `options.data = { role: 'admin' }` using the public anon key; the trigger runs `SECURITY DEFINER`, bypasses RLS, and stamps the new profile as admin. From that point the JWT claim written by `custom_access_token_hook` carries `app_role = admin` and the proxy plus every RLS helper treat the caller as an administrator.

The PID and the `lib/auth/actions.ts` `signUp` action are explicit that provider / admin accounts are invite-only and that `signUp` is receiver-only. But that is enforced only by the Server Action the UI happens to call. The underlying Supabase anon-key endpoint is not gated and the trigger is the single enforcement point - and it is missing.

**Reproduction (browser console on the deployed app):**
```js
const sb = window.supabase ?? createClient(URL, ANON_KEY);
await sb.auth.signUp({
  email: 'attacker@example.test',
  password: 'hunter2!',
  options: { data: { role: 'admin', display_name: 'pwn' } },
});
// Sign in, refresh token -> JWT now carries app_role=admin.
```

**Suggested fix direction:** In `handle_new_auth_user`, coerce any role other than `'receiver'` to `'receiver'` (or raise) regardless of what the metadata says; keep the receiver-only path. Privileged roles must only be reachable via the admin invite path (`inviteAdmin` with service-role key, which can set `raw_user_meta_data.role` server-side). Additionally, the profiles test at `profiles.test.sql:34-38` currently locks in the broken behaviour - it should be rewritten to assert the coercion.

---

## 2. HIGH - Authenticated users can read provider `email` (PII leak) via the public directory policy

**File/line:** `supabase/migrations/0001_profiles_and_roles.sql:275-287`

**Bug:** The anon grant is correctly column-narrowed to `(id, role, display_name)`, but the parallel grant line `grant select, insert, update, delete on public.profiles to authenticated;` is *not* column-narrowed, and the `profiles_public_directory` SELECT policy applies to **both** `anon` and `authenticated`. That means any logged-in receiver can issue:
```sql
select id, email, display_name
from public.profiles
where role = 'provider';
```
and harvest every provider's `email` column. The PID treats `profiles.email` as private (it is deliberately withheld from the anon column grant); the authenticated column grant silently re-exposes it for the entire directory.

**Reproduction:** sign in as any `receiver`, call `supabase.from('profiles').select('id,email,display_name').eq('role','provider')`. All rows come back with their `email` populated.

**Suggested fix direction:** either (a) narrow the authenticated column grant to the same public set and force owner/admin reads through a separate policy with a wider grant, or (b) drop `authenticated` from `profiles_public_directory` and add a dedicated `profiles_auth_directory` policy that restricts the returned columns via a view - a SQL-side column narrowing is simplest and does not require a view.

---

## 3. HIGH - `documents_owner_insert` does not constrain non-`provider_id` subject FKs

**File/line:** `supabase/migrations/0004_provider_onboarding.sql:304-313`

**Bug:** The WITH CHECK enforces `uploaded_by = current_profile_id()` and (optionally) `provider_id = current_profile_id()`, but does *nothing* about `provider_company_id`, `receiver_id`, `care_plan_id`, `visit_id`, or `message_id`. The `documents_exactly_one_subject` CHECK only forces exactly one FK to be set; it does not care which one. A malicious authenticated provider can therefore upload a file and attribute it to an arbitrary `receiver_id` (or `care_plan_id`, etc.):

```sql
insert into public.documents
  (uploaded_by, receiver_id, kind, title, storage_bucket, storage_path, mime_type, size_bytes)
values
  (app.current_profile_id(), '<victim-receiver-uuid>', 'other', 'planted',
   'provider-docs', 'quarantine/<me>/x.pdf', 'application/pdf', 1);
```

Today this only pollutes the vault (the owner can still read it because `uploaded_by = me`) and produces a bogus `verifications` row, but C4/C10/C11 will join on `documents.receiver_id` / `care_plan_id` / `visit_id` to build the receiver's document pane. Once those joins land, a single Phase 1a row poisons a Phase 1b surface and leaks into another user's "my documents" view.

**Reproduction tested only via direct SQL; the targeted `documents.test.sql:174-184` only exercises the `provider_id` path.**

**Suggested fix direction:** add explicit per-FK checks to the WITH CHECK clause, e.g. `receiver_id is null or receiver_id = app.current_profile_id()`, and the equivalent for each subject FK (with a helper for care-plan / visit / message reachability once those tables exist). Phase 1a can hard-null the unused columns: `provider_company_id is null and receiver_id is null and care_plan_id is null and visit_id is null and message_id is null`.

---

## 4. HIGH - `audit_log` INSERT policy allows forged "system" rows and pollutes the hash chain

**File/line:** `supabase/migrations/0002_audit_log.sql:95-104`

**Bug:** The policy reads
```sql
with check (
  actor_id is null
  or actor_id = app.current_profile_id()
  or app.current_role() = 'admin'
)
```
The first branch lets *any* authenticated user insert rows with `actor_id = null` and a completely attacker-controlled `action`, `subject_table`, `subject_id`, `before`, and `after`. Because every row advances the hash chain (`prev_hash = last row.row_hash`), an attacker can:

1. Flood the chain with arbitrary "system" entries, shifting hashes and making any external tamper-evidence check much noisier to reason about.
2. Insert fabricated audit rows that later appear in admin dashboards as uncredited system events (`audit_log_admin_select` shows them to admins).

The W2 intent is that audit rows are produced by the server-side `recordAuditEvent` helper which always stamps `actor_id`. There is no legitimate reason for a user-initiated insert to omit it.

**Reproduction:** sign in as any authenticated user, issue
```sql
insert into public.audit_log(actor_id, action, subject_table, subject_id, before, after)
values (null, 'profiles.wipe', 'profiles', '<victim-id>', null, '{"wiped":true}');
```
The insert succeeds, the hash-chain trigger computes a valid `row_hash`, and an admin viewing the log sees a ghost system action.

**Suggested fix direction:** drop the `actor_id is null` branch. Require `actor_id = app.current_profile_id()` unconditionally for authenticated inserts; restrict any future "system" audit events to the admin client path (service role) or a SECURITY DEFINER helper that stamps a stable sentinel actor. Update `audit_log.test.sql` to cover the null-actor path as a throws_ok, not a permitted case.

---

## 5. HIGH - `tg_documents_guard` blocks the service-role document promotion path

**File/line:** `supabase/migrations/0004_provider_onboarding.sql:227-274`

**Bug:** The C3a `promote()` flow (per the C3a section of `docs/pid.md`) uses the service-role admin client to flip a document's `status` from `'quarantined'` to `'available'` after the virus-scan step. `createAdminClient()` bypasses RLS but **does not bypass triggers**. Inside the trigger, `app.current_role()` reads `request.jwt.claims` - the service role does not populate `app_role` there, so the function falls through to
```sql
select role from public.profiles where id = auth.uid() and deleted_at is null
```
which is `null` (the service role has `auth.uid() = null`). The trigger's early-return check
```sql
if app.current_role() = 'admin'::public.app_role then return new; end if;
```
resolves to `null = 'admin'` → unknown → false, so the guard runs and raises `status changes are admin-only` on the very first line-of-business flow that touches it.

The pgTAP test at `documents.test.sql:191-210` only covers status flips made under a manually-forged `app_role=admin` claim, so CI never exercises the real service-role promote path and the bug went uncaught.

**Reproduction:** run the `lib/documents/promote.ts` flow (or call `createAdminClient().from('documents').update({ status: 'available' }).eq('id', <id>)`) - the UPDATE throws.

**Suggested fix direction:** either (a) early-return from `tg_documents_guard` when the caller is the `service_role` (`current_user = 'service_role'` or `current_setting('request.jwt.claim.role', true) = 'service_role'`), or (b) perform the promote through a `SECURITY DEFINER` helper in the `app` schema that stamps `status` and bypasses the trigger via `session_replication_role = replica`. Add a pgTAP test that runs the promote under `set local role service_role` so the service-role path is exercised by CI.

---

## 6. MEDIUM - Self-promotion race in `public.ensure_super_admin`

**File/line:** `supabase/migrations/0003_seed_super_admin.sql:21-62`

**Bug:** `ensure_super_admin` is `SECURITY DEFINER` with no `REVOKE EXECUTE` and no role guard. PostgreSQL default grants `EXECUTE` on new functions to `PUBLIC`, so any `anon` or `authenticated` caller can invoke it. The body is idempotent - it exits early once any non-deleted admin exists - but there is a window during bootstrap (or, more alarmingly, after every admin is soft-deleted) where the function:

1. Sees zero admins → enters the promotion path.
2. Looks up `auth.users` by an attacker-supplied email, and
3. Inserts or updates `profiles` setting `role = 'admin'` and `deleted_at = null`.

During the "no admins exist" window, an attacker who knows any *existing* user's email can promote that user to admin (effectively seizing the account the moment it next signs in) by calling `select public.ensure_super_admin('victim@example.com')`. If all admins are soft-deleted (DSAR, test cleanup, an over-eager erasure sweep) the window reopens.

**Reproduction:** drop all admins via SQL (`update public.profiles set deleted_at = now() where role = 'admin'`), then as any authenticated user call `select public.ensure_super_admin('victim@t.test')`. The victim now has `role = 'admin'` and `deleted_at = null`.

**Suggested fix direction:** `revoke execute on function public.ensure_super_admin(text) from public, anon, authenticated;` and grant execute only to `postgres` / `supabase_admin`. If callability from a SQL console matters, keep the grant on `postgres` only.

---

## 7. MEDIUM - 0007 "policy fix" drops the PID-mandated `deleted_at IS NULL` from `documents_owner_read`

**File/line:** `supabase/migrations/0007_rls_policy_fixes.sql:26-31`

**Bug:** The PID RLS-safety conventions section is explicit: *"Read policies always include `AND deleted_at IS NULL`."* Migration 0007 deletes the filter from `documents_owner_read` because the owner soft-delete path otherwise fails on the Supabase JS `.update(...).returning()` round-trip. The fix trades a structural invariant for a client-side convention: "application code already filters via `.is('deleted_at', null)`". Every future query that forgets that filter silently leaks soft-deleted documents to their owner, and a future DSAR audit that uses the "my documents" API to validate erasure will see rows that should be invisible.

This is not a vulnerability that leaks cross-tenant data today, but it is a direct, documented violation of a non-negotiable PID rule, and the reason the real bug was masked (the pgTAP test at `documents.test.sql:137-147` now asserts the buggy behaviour as the expected shape).

**Suggested fix direction:** restore `deleted_at is null` to `documents_owner_read`. Fix the underlying Supabase client path by either (a) using `.update(...).select(..., { count: 'exact', head: true })` so no rows are returned and SELECT visibility is not required, (b) wrapping the soft-delete in a `SECURITY DEFINER` `app.soft_delete_document(uuid)` helper, or (c) adding a second narrow SELECT policy that makes rows with `deleted_at` just set still visible to the owner for a single statement (e.g. via `xmin = pg_current_xact_id()::xid`). The PID rule is more important than the Supabase ergonomics.

---

## 8. MEDIUM - `provider_certifications_owner_update` allows the owner to un-soft-delete their own rows

**File/line:** `supabase/migrations/0005_provider_services_capabilities.sql:425-431`

**Bug:** The policy is
```sql
using (provider_id = app.current_profile_id())
with check (provider_id = app.current_profile_id())
```
No `deleted_at` filter on either side. Every other regulated table in the repo (`profiles`, `provider_profiles`, `documents`) ships a guard trigger that raises `undelete is admin-only`; `provider_certifications` has no such trigger, so the owner can flip `deleted_at` from non-null back to `null`. Combined with the partial unique index `provider_certifications_active_unique (provider_id, certification_id) where deleted_at is null`, an owner can also un-delete a historical row after a new one is inserted, causing the partial unique index to reject the resurrection in a confusing way (the UPDATE throws `unique_violation`). Either outcome (undelete, or confusing write failure) is wrong.

**Reproduction:** as the owner, insert a certification, soft-delete it, then `update provider_certifications set deleted_at = null where id = <id>`. The update succeeds unless another active row for the same certification type exists.

**Suggested fix direction:** add a `tg_provider_certifications_guard` BEFORE UPDATE trigger mirroring `tg_provider_profiles_guard_verification`: reject non-admin transitions of `deleted_at` from non-null to null, and optionally freeze `certification_id` / `document_id` / `reference` on the owner path.

---

## 9. MEDIUM - `contact_requests_party_update` lets a provider unilaterally soft-delete a request the receiver created (and vice versa)

**File/line:** `supabase/migrations/0008_contact_messaging.sql:211-221` + guard trigger at `0008_contact_messaging.sql:85-131`

**Bug:** The UPDATE policy accepts either party (`receiver_id` or `provider_id`) as the acting user, and the guard trigger only rejects changes to `receiver_id` / `provider_id` / `subject` / `body` / `status`. Changes to `deleted_at` fall through the "No status change: allow (e.g. soft-delete by owner)" branch. Because both SELECT policies (`contact_requests_receiver_read`, `contact_requests_provider_read`) filter on `deleted_at is null`, a malicious provider can set `deleted_at = now()` on a pending inbound request and the row disappears from *both* parties' views - the receiver's outbox suddenly drops the request they sent, and the provider just "hid" it unilaterally. A malicious receiver can do the same thing to a pending provider inbox entry.

This is not cross-tenant read exposure but it is a write-side censorship attack that breaks the contract of "both parties see their conversation".

**Suggested fix direction:** in the guard trigger, also reject `new.deleted_at is distinct from old.deleted_at` on the non-admin path (soft-delete of contact requests is an admin-only operation in practice). If users need a "hide from my view" feature later, it belongs in a per-user join table, not in a shared `deleted_at` column.

---

## 10. MEDIUM - `contact_thread_posts` rate limit is per-author global, not per-thread

**File/line:** `supabase/migrations/0008_contact_messaging.sql:560-574`

**Bug:** The PID specifies "per-thread rate limit on thread posts" as a launch-blocking C8 abuse control. The trigger calls `app.bump_rate_limit('thread_post.create', 60, 30)` with a fixed scope key; `bump_rate_limit` keys the bucket on `(profile_id, scope_key, window_start)`. The effective limit is therefore "30 posts per author per minute across all threads", not "N per author per thread per minute". An attacker can concentrate 30 posts per minute on a single victim thread, which is plausibly enough to spam-drown the other party given the 2000-char body cap. Per-thread throttling is the explicit PID requirement.

**Suggested fix direction:** concatenate the thread id into the scope key: `perform app.bump_rate_limit('thread_post.create:' || new.thread_id::text, 60, <per_thread_limit>);` - or introduce a dedicated per-thread bucket with a lower ceiling and keep the per-author bucket as a cross-thread backstop.

---

## 11. MEDIUM - `contact_requests` creation has no rate limit on the DB side

**File/line:** `supabase/migrations/0008_contact_messaging.sql:55-205`

**Bug:** The PID is explicit: "per-receiver rolling rate limit on contact-request creation (for example, N per hour per account and M per IP)" is a launch-blocking C8 abuse control. Migration 0008 ships `rate_limit_buckets` and `app.bump_rate_limit` but never wires them into `contact_requests`. There is no BEFORE INSERT trigger on `contact_requests`, and the insert policy has no volume check. If the `lib/contact/*` Server Actions forget to call `bump_rate_limit` on the create path, a logged-in attacker can post 2000-char bodies against every provider in the directory without any DB-side brake.

Strictly speaking, PID compliance could be satisfied in application code, but every other abuse control in this migration (thread posts) is enforced via a DB trigger, which is the right place because it cannot be bypassed by a direct PostgREST call with the anon key. The omission here is inconsistent and the auth-auditor / contact-auditor should verify `lib/contact/*` before this is closed.

**Suggested fix direction:** add a BEFORE INSERT trigger on `contact_requests` that calls `app.bump_rate_limit('contact_request.create', 3600, <per_hour>)`. IP-bucketing is harder from the DB side and can legitimately live in the Server Action; the per-account bucket should be in the DB.

---

## 12. MEDIUM - Soft-deleted profiles keep their `app_role` claim for the life of the current JWT

**File/line:** `supabase/migrations/0001_profiles_and_roles.sql:175-206` (`app.current_role()`) and `0001_profiles_and_roles.sql:131-156` (`custom_access_token_hook`)

**Bug:** The custom access token hook and `app.current_role()` fallback both filter on `deleted_at is null` - good, so a fresh JWT after soft-delete will be claimless. But `app.current_role()` returns the JWT claim **first** without re-checking `profiles.deleted_at`. When an admin soft-deletes a user (DSAR cool-off, or `profiles_admin_update set deleted_at = now()`), the user's existing session JWT still carries `app_role = <role>` until its natural refresh (up to an hour). For the duration of the window they can still act with full role permissions - including mutating their own `profile`, creating `contact_requests`, uploading documents, etc. DSAR erasure is a Phase 1b concern but the cool-off mechanism is built on this assumption today.

**Suggested fix direction:** in `app.current_role()`, after reading the JWT claim, cross-check `profiles.deleted_at is null` for the same `auth.uid()` and return `null` on mismatch. This adds one indexed lookup per request but matches the "deleted_at as kill-switch" expectation.

---

## 13. LOW - `tg_meeting_proposals_guard` reads `contact_requests` without SECURITY DEFINER and can trip on its own RLS

**File/line:** `supabase/migrations/0008_contact_messaging.sql:274-334`

**Bug:** The guard trigger does `select * into v_cr from public.contact_requests where id = old.contact_request_id` in the invoker's security context. If the invoker has UPDATE visibility on the `meeting_proposals` row (via `meeting_proposals_party_update`) but no SELECT visibility on the underlying `contact_requests` row (for example because that row has been soft-deleted and both `contact_requests_*_read` policies filter on `deleted_at is null`), the subquery returns no rows and `v_cr.receiver_id` / `v_cr.provider_id` are both null. The subsequent `v_me not in (v_cr.receiver_id, v_cr.provider_id)` then raises "only a party on the contact request may respond to a proposal" for a caller who legitimately is a party. The failure mode is a blocked UPDATE, not a security hole, but it is a confusing error surface the minute soft-delete lands in Finding #9 or in Phase 1b DSAR work.

**Suggested fix direction:** mark the trigger body `security definer` with a narrowed `set search_path = public, app` (mirroring `tg_contact_requests_open_thread`) so the lookup is deterministic regardless of RLS.

---

## 14. LOW - `provider_services` and `provider_capabilities` public-read EXISTS does not filter `deleted_at` on `provider_profiles`

**File/line:** `supabase/migrations/0005_provider_services_capabilities.sql:227-239` and `290-302`

**Bug:** The inline `EXISTS` in the public-read policy checks only `pp.verified_at is not null`. The comment at the top of the migration explains the deliberate omission: the narrow anon column grant on `provider_profiles` does not expose `deleted_at`, and soft-delete filtering is expected to be enforced transitively by `provider_profiles_public_read`. That reasoning is correct **today** but it is fragile: it depends on a second RLS policy matching on a specific row which is an implementation detail of the planner, not a contract. If someone later grants a wider column set on `provider_profiles` the transitive enforcement silently disappears.

**Suggested fix direction:** either (a) grant the anon column set that covers `deleted_at` and include the filter directly (the simpler option, and matches every other read policy in the repo), or (b) replace the inline EXISTS with a helper `app.is_public_provider(pp_id uuid)` that encapsulates both conditions and is the single place to change when the rule evolves.

---

## 15. LOW - `meeting_proposals_party_read` does not re-check `cr.deleted_at`

**File/line:** `supabase/migrations/0008_contact_messaging.sql:341-355`

**Bug:** The SELECT policy requires `cr.status = 'accepted'` but does not join on `cr.deleted_at is null`. If a `contact_requests` row is soft-deleted (see Finding #9, or via the admin path) while still `status = 'accepted'`, its meeting proposals remain visible to both parties, even though the request itself has been hidden from every other surface. Minor because only happens after an admin action, but inconsistent with `contact_thread_posts_party_read` at line 582 which *does* filter on `t.deleted_at is null`.

**Suggested fix direction:** add `and cr.deleted_at is null` to both the SELECT and UPDATE policy's EXISTS.

---

## 16. LOW - `search_providers` ILIKE is wildcard-injectable

**File/line:** `supabase/migrations/0006_provider_search.sql:151-157`

**Bug:** `pp.headline ilike '%' || query || '%'` pastes user input into a LIKE pattern without escaping `%` or `_`. This is not SQL injection (the parameter is bound), but an anon caller can pass `query = '%_%_%_%_%'` or a `\` to defeat the trigram GIN indexes and force seq-scans, giving any anon caller a cheap DoS against the public directory. The `limit_count` cap at 100 helps but does not stop a full-table scan under a wildcard-heavy pattern.

**Suggested fix direction:** either strip or escape `%` / `_` / `\` in `query` at the function entry (`replace(query, '\', '\\')` etc.) or use `query ilike concat('%', escape_like(query), '%')` via a small helper. Also consider using `websearch_to_tsquery` on a generated tsvector column if full-text becomes a Phase 1b need.

---

## 17. LOW - pgTAP coverage gaps

The PID is explicit that every RLS policy ships with a pgTAP test exercising allowed and denied paths (`W3` in `docs/pid.md`). Several policies in Phase 1a have no corresponding negative path test:

- `contact_requests.test.sql` does not cover the soft-delete censorship scenario in Finding #9.
- `documents.test.sql` does not cover the non-`provider_id` subject-FK attack in Finding #3 (`uploaded_by = me, receiver_id = <victim>`).
- `audit_log.test.sql:90-96` asserts that impersonating another `actor_id` throws, but does not assert that `actor_id is null` is rejected - because it is currently permitted (Finding #4).
- No test exercises the service-role document promote path that Finding #5 breaks - pgTAP only runs under forged admin claims, not under `set local role service_role`.
- No test exists for `app.bump_rate_limit` per-thread isolation or for the absence of a rate limit on `contact_requests` (Finding #11).
- `provider_certifications.test.sql` has no test for owner un-soft-delete (Finding #8).
- `profiles.test.sql:34-38` locks in the vulnerable raw_user_meta_data.role honouring (Finding #1) rather than asserting it is rejected.

These gaps should be filled as part of the fix PRs for the findings they map to, not as a separate cleanup.

---

## Severity roll-up

| Severity | Count | Findings |
|----------|-------|----------|
| critical | 1 | #1 |
| high     | 4 | #2, #3, #4, #5 |
| medium   | 7 | #6, #7, #8, #9, #10, #11, #12 |
| low      | 5 | #13, #14, #15, #16, #17 |

Total: 17.

Findings #1 (role escalation on sign-up) and #2 (provider email leak) are the two that block shipping to real users. #3 (documents subject-FK) and #5 (service-role promote is broken) will both bite Phase 1b work the moment it lands and should be fixed before any C3b / C4 / C10 code is written on top of the current document vault. #4 (audit log null-actor forgery) undermines the integrity claim that W2 exists to provide.
