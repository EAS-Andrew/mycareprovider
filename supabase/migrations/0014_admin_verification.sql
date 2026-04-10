-- 0014_admin_verification.sql
--
-- C5: Admin verification console.
--   - Indexes to accelerate admin verification queues (pending documents,
--     unverified providers, unverified companies, unverified family
--     authorisations)
--   - No new tables needed: the verification infrastructure from 0004,
--     0011, and 0012 already has the state machine, guard triggers, and
--     RLS policies. This migration adds query-path indexes only.

-- =============================================================================
-- Indexes for admin verification queues
-- =============================================================================

-- Pending/in-review verifications (the main admin queue)
create index if not exists verifications_pending_idx
  on public.verifications (state, created_at)
  where state in ('pending', 'in_review');

-- Unverified providers (not yet verified_at, not deleted)
create index if not exists provider_profiles_unverified_idx
  on public.provider_profiles (created_at)
  where verified_at is null and deleted_at is null;

-- Unverified companies (not yet verified_at, not deleted)
create index if not exists provider_companies_unverified_idx
  on public.provider_companies (created_at)
  where verified_at is null and deleted_at is null;

-- Unverified family authorisations (not yet verified_at, not deleted)
create index if not exists family_authorisations_unverified_idx
  on public.family_authorisations (created_at)
  where verified_at is null and deleted_at is null;

-- Documents by status for admin review (quarantined docs needing attention)
create index if not exists documents_status_idx
  on public.documents (status, created_at)
  where deleted_at is null;
