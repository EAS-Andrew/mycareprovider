-- 0007_rls_policy_fixes.sql
--
-- Forward-only policy fix for a pre-existing bug in C3a (0004_provider_onboarding.sql).
--
-- Bug: the `documents_owner_soft_delete` policy allows an owner to set
-- deleted_at on their own document, but Postgres also requires the updated
-- row to remain visible under at least one applicable SELECT policy. The
-- original `documents_owner_read` USING clause filtered on
-- `deleted_at IS NULL`, so the soft-deleted row became invisible to the
-- owner immediately after the UPDATE, and Postgres rejected the UPDATE with
-- `new row violates row-level security policy for table "documents"`.
--
-- Effect: the `softDeleteDocument` Server Action in lib/documents/actions.ts
-- could never succeed for a real user. The bug was masked because the
-- C3a pgTAP suite (supabase/tests/rls/documents.test.sql) was never executed
-- under `supabase test db` before C8.
--
-- Fix: drop the `deleted_at IS NULL` filter from `documents_owner_read`.
-- Application code already filters via `.is("deleted_at", null)` wherever
-- the UI wants to hide soft-deleted rows (see lib/documents/actions.ts:217
-- and lib/providers/profile-actions.ts:87). Removing the RLS-level filter
-- means the owner can still see their row during the UPDATE, so the
-- soft-delete path works, and normal list queries are unaffected because
-- they filter explicitly.

drop policy if exists documents_owner_read on public.documents;
create policy documents_owner_read
  on public.documents
  for select
  to authenticated
  using (uploaded_by = app.current_profile_id());
