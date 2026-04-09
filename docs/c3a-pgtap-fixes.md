# C3a pgTAP follow-up fixes

Pre-existing `supabase test db` failures discovered during C8 prep. The C2/C3a
pgTAP suites were authored but never executed against the live stack, so three
broken files and one real RLS policy bug slipped through. All fixed in a
forward-only way (migrations 0001-0006 untouched since they are already applied
against hosted Supabase).

## 1. documents.test.sql -> real policy bug (migration 0007)

**Symptom:** `supabase/tests/rls/documents.test.sql` at the owner soft-delete
step raised `new row violates row-level security policy for table "documents"`.

**Root cause:** `documents_owner_read` USING clause filtered `deleted_at IS
NULL`. On UPDATE, Postgres requires the updated row to remain visible under at
least one applicable SELECT policy. Soft-deleting a row flips `deleted_at` to a
timestamp, which removed it from the owner_read policy, and Postgres rejected
the UPDATE. The `softDeleteDocument` Server Action in
`lib/documents/actions.ts` could therefore never succeed for a real user - it
was broken in production since C3a merged.

**Fix:** `supabase/migrations/0007_rls_policy_fixes.sql` drops and recreates
`documents_owner_read` without the `deleted_at IS NULL` filter. Application
code already filters `deleted_at IS NULL` at the query layer wherever the UI
hides soft-deleted rows (see `lib/documents/actions.ts:217` and
`lib/providers/profile-actions.ts:87`), so the RLS-level filter was redundant
defence that happened to make the soft-delete path unusable. Test assertions
updated to reflect that the row is still visible via RLS post-delete but
hidden by application-level WHERE clauses.

## 2. audit_log.test.sql -> test-only bug

**Symptom:** `ERROR: permission denied for table audit_log` during UPDATE/DELETE
assertions.

**Root cause:** The test expected UPDATE/DELETE to be silently denied via RLS
default-deny (`0 rows affected`). But `0002_audit_log.sql` REVOKEs UPDATE and
DELETE at the grant level, so the attempt throws `42501` instead - a stronger
guarantee than silent zero-row behaviour. The migration is correct; the test
expectation was wrong.

**Fix:** Rewrote the UPDATE/DELETE assertions to use `throws_ok('42501', ...)`.
Plan count bumped 10 -> 11.

## 3. provider_profiles.test.sql -> fixture UUID collision

**Symptom:** `duplicate key value violates unique constraint "users_pkey"` on
the first fixture `insert into auth.users`.

**Root cause:** The test fixtures reused UUIDs `...a1` and `...a2`, which
`supabase/seed.sql` already claims for the seed admin + support accounts.
`supabase db reset` replays seed.sql before `supabase test db` runs, so the
test's inserts collided.

**Fix:** Renamed the three fixture UUIDs to `...f1` / `...f2` / `...fd`.
Pattern matches `provider_search.test.sql`, which avoids the seed namespace by
using distinctive suffixes.

## Notes for future engineers

- Always run `supabase db reset && supabase test db` locally before landing
  anything that touches `supabase/**`. The CI wiring for pgTAP is still TBD.
- When picking fixture UUIDs, do NOT reuse the low-order nibble slots
  `...a1`/`...a2`/`...ad` - those are reserved by `seed.sql`. Use a
  test-specific suffix like `...f1` or `...c8xx`.
- The "updated row must remain visible via SELECT policy" gotcha bites any
  soft-delete policy that reads `deleted_at IS NULL`. If you add another
  soft-delete policy elsewhere, drop the `deleted_at` filter from the
  matching owner SELECT policy and filter at the application layer instead.
- Migration `0007_rls_policy_fixes.sql` is a forward-only fix - do NOT edit
  `0004_provider_onboarding.sql` in place, it is applied against hosted
  Supabase.
