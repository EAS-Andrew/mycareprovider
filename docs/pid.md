
## Product Initiation Document

### Executive Summary

MyCareProvider is a comprehensive digital platform designed to connect care receivers with care providers, offering complete freedom and choice in care arrangements. The platform serves as a marketplace and management system for the entire care provision lifecycle, from provider discovery to payment processing. The system will generate revenue through a platform commission on all transactions processed through the platform, set at a flat 5% at launch.

### Vision & Objectives

**Vision:** To create a transparent, accessible, and efficient ecosystem for care provision that empowers both care receivers and providers.

**Objectives:**

1. Create a secure, user-friendly platform that connects qualified care providers with care receivers
2. Provide comprehensive tools for managing the entire care provision lifecycle
3. Ensure transparency in care plans, pricing, and provider qualifications
4. Enable seamless communication between all stakeholders
5. Facilitate secure and reliable payment processing
6. Ensure compliance with healthcare regulations, CQC requirements, and data protection laws

### Market Overview

The healthcare and personal care services market is experiencing significant growth due to ageing populations and increased preference for home-based care. Current solutions often lack transparency, customisation options, and comprehensive management tools. MyCareProvider addresses these gaps by offering a complete ecosystem for care provision.

### Target Audience

#### Care Providers:

- Individual care professionals
- Care provider companies
- Healthcare professionals seeking additional clients

#### Care Receivers:

- Individuals requiring personal care services
- Elderly people seeking assistance
- People with disabilities or chronic conditions
- Individuals recovering from illness or surgery

#### Care Receiver Family Members:

- Family members managing care for loved ones
- Legal guardians with power of attorney
- Family members involved in care decisions

#### System Administrators:

- Platform managers ensuring system integrity
- Customer support representatives
- Compliance officers

### Key Features

Detailed acceptance criteria for each feature live in `docs/user_stories.md`; the components in the Implementation Phases section below reference those stories by number so work can be picked up in isolation.

#### For Care Providers/Companies:

- Registration and profile creation
- Documentation submission (certifications, insurance, etc.)
- Service listing and pricing
- Availability management
- Client communication tools
- Visit documentation and check-ins
- Payment processing
- Care plan management

#### For Care Receivers/Family Members:

- Provider search with advanced filtering
- Provider profile viewing
- Initial contact and meeting setup
- Care plan review and approval
- Communication tools
- Visit verification
- Payment management
- Feedback and concerns reporting

#### For System Administrators:

- User management
- Verification processes
- Dispute resolution
- System monitoring
- Analytics and reporting

### Technical Architecture

The platform is delivered as a single Next.js application backed by Supabase, hosted on Vercel. This replaces the earlier microservice-oriented plan: Supabase Row-Level Security plus Next.js Server Actions removes most of the bespoke auth and service-to-service plumbing a microservice stack would require, and Vercel Fluid Compute removes the cold-start pressure that historically pushed similar platforms toward long-running services.

**Frontend & backend (single codebase):**

- Next.js (App Router, latest stable) on Vercel Fluid Compute
- Server Components and Server Actions for data access and mutations
- Route Handlers for webhooks and third-party callbacks
- Single app with `/app/(public)`, `/app/(provider)`, `/app/(receiver)`, and `/app/(admin)` route groups
- Role enforcement in Routing Middleware that reads the Supabase session and redirects based on role claim
- Tailwind CSS and shadcn/ui as the shared design system

**Database:**

- Supabase Postgres with Row-Level Security enforced on every table
- Schema migrations managed via the Supabase CLI and checked into the repo under `supabase/migrations/`
- TLS in transit and at rest by default

**Authentication & authorization:**

- Supabase Auth with email + password and magic link; OAuth providers optional
- Application roles (`admin`, `provider`, `provider_company`, `receiver`, `family_member`) stored in a `profiles` table joined to `auth.users`
- Role exposed as a custom JWT claim and used by RLS policies

**Core domain model:**

The following entities are fixed at PID stage so that RLS policy design, Supabase migrations, and API typing can proceed in parallel with C1. Cardinality and field detail are deferred to schema design, but the set of tables, their ownership, and the **RLS-safety conventions below** are authoritative.

- **Identity & org**: `profiles`, `provider_profiles`, `provider_companies`, `company_memberships`, `receiver_profiles`, `care_circles`, `care_circle_members`, `family_authorisations`, `invitations`
- **Reference data** (normalised so that filters and search are indexable): `service_categories`, `capabilities`, `certifications`, `provider_services`, `provider_capabilities`, `provider_certifications`
- **Availability**: `provider_availability` (recurring weekly pattern), `provider_time_off` (exceptions)
- **Trust & verification**: `documents` (see RLS-safety note below), `verifications` (state machine, linked to documents), `external_verifications` (unified DBS, insurance, ID check, right-to-work records with a `verification_type` enum and live-provider status), `audit_log` (append-only, hash-chained for tamper evidence)
- **Discovery & contact**: `contact_requests`, `meeting_proposals`, `contact_threads`, `contact_thread_posts` (both retired in Phase 2 when C9 migrates their contents into `conversations`)
- **Communication**: `conversations`, `conversation_participants`, `messages`, `message_attachments`, `notifications` (durable per-user delivery record so offline users still see care updates, emergency alerts, and medication changes on next login)
- **Care delivery**: `care_plans`, `care_plan_versions` (append-only **full snapshots** per revision - not diffs - so no replay is needed to reconstruct a historical plan), `care_plan_line_items`, `visits`, `visit_notes`, `visit_media`, `medications`, `medication_schedules`, `medication_administrations`
- **Money**: `stripe_accounts`, `commission_agreements` (per-provider rate config with `effective_from` / `effective_to`), `commission_ledger` (append-only log of charged commission amounts referencing an agreement), `invoices`, `invoice_items`, `payments` (with unique `stripe_payment_intent_id`), `payouts` (with unique `stripe_transfer_id`), `gocardless_mandates`
- **Safeguarding**: `safeguarding_reports` (append-only, elevated retention, exempt from C24 erasure, RLS restricted to safeguarding lead + reporter), `safeguarding_report_events` (triage, assignment, escalation decisions, resolution notes)
- **Disputes**: `disputes` (one per raised issue with linked `visit_id`, `care_plan_id`, or `payment_id`), `dispute_events` (append-only timeline of submissions, evidence, admin actions, refunds, fee adjustments)
- **Abuse controls**: `rate_limit_buckets` (per-user, per-endpoint rolling counters - may be backed by Postgres or an external KV such as Upstash Redis; the choice does not change the data-model contract)
- **Ops & compliance**: `dsar_requests`, `erasure_requests`, `feature_flags`

**RLS-safety conventions (non-negotiable):**

1. **No polymorphic `(owner_type, owner_id)` pairs.** The `documents` table carries **nullable foreign keys** (`provider_id`, `provider_company_id`, `receiver_id`, `care_plan_id`, `visit_id`, `message_id`) and a `CHECK` constraint that exactly one is non-null. Every RLS policy joins on a real FK rather than matching on a discriminator string. Polymorphic ownership is explicitly banned because it cannot be expressed as a clean `USING` clause and defeats the point of RLS.
2. **Soft-delete convention for erasure cool-off.** Every regulated table (everything except pure reference tables and the audit log) carries a `deleted_at TIMESTAMPTZ NULL` column. Read policies always include `AND deleted_at IS NULL`. The C24 erasure flow sets `deleted_at`, waits out the 30-day cool-off, then a scheduled job hard-deletes rows that are not held by a legal retention rule. This gives a uniform, Postgres-native erasure story instead of a separate schedule table.
3. **RLS helper functions** live in a dedicated `app` schema and are the only thing policies call. At a minimum: `app.current_profile_id()`, `app.current_role()`, `app.is_care_circle_member(circle_id uuid)`, `app.is_company_member(company_id uuid)`, `app.is_provider_verified()`, `app.can_see_care_plan(care_plan_id uuid)`. Every policy is a one-liner calling one of these helpers. Policies that inline SQL joins are rejected in review. (The `auth` schema was considered and rejected: Supabase reserves it for its auth service and forbids CREATE from the postgres role, so helpers must live in a schema we own. This was discovered during the C2 local-stack bringup.)
4. **Append-only tables** (`audit_log`, `care_plan_versions`, `commission_ledger`, `medication_administrations`, `visit_notes`) have no UPDATE or DELETE policies at all; they are `INSERT`-only from application code and readable by the owning subject plus compliance roles.
5. **Pure reference tables** (`service_categories`, `capabilities`, `certifications`) are world-readable and admin-writable; RLS is still enabled so the default is deny.

Every other (non-reference, non-audit) table has RLS enabled. Read policies are derived from the requesting user's role claim plus membership in `care_circles` or `company_memberships`; write policies additionally check the verification state of the acting party where relevant. Every RLS policy ships with a pgTAP test per W3.

**File storage:**

- Supabase Storage buckets: `provider-docs` (certifications, DBS, insurance), `receiver-docs` (authorisation), `care-plan-attachments`, `visit-media`
- Private by default; time-limited signed URLs issued from Server Actions
- **Every upload is passed through a MIME allow-list and a virus scan before the object is considered "available".** Supabase Storage does not scan by default, so uploads land in a `-quarantine` staging prefix, a Vercel Cron or Supabase Edge Function scans them (for example, ClamAV via a sidecar or a third-party scan API), and only clean objects are moved to the canonical path. Rejected objects are purged and the uploader is notified through C8/C9 channels.
- **Abuse and content controls:** Vercel BotID on all public upload endpoints; per-user upload rate limits via `rate_limit_buckets`; `visit-media` additionally enforces the C10/C11 consent rules before the signed-URL issuer will produce a read URL.

**Realtime & messaging:**

- Supabase Realtime (Postgres changefeed) for secure messaging, visit status, and care-plan updates

**Background work:**

- Supabase Edge Functions for scheduled jobs (for example, document expiry reminders)
- Vercel Cron for Next.js-side scheduled work
- Durable multi-step flows (document verification pipeline, payment reconciliation) use Vercel Workflow DevKit so they survive crashes, retries, and async callbacks

**Mobile experience:**

- Progressive Web App with web manifest, service worker, offline shell, and Web Push
- **Single installable PWA with the unified brand mark** on the install surface; the UI themes to the correct side (blue for receivers, purple for providers, neutral for admins) after login. Two separate installable scopes per audience were considered and deferred to a Phase 3 revisit alongside C15 because they would complicate deep-link resolution and double the install funnel for no Phase 1 benefit.
- No native mobile toolchain in scope; the PWA is the mobile deliverable. A native app may be reconsidered after Phase 3 based on usage data.

**Brand & theming:**

The brand system in `docs/brand/COLORS.md` is an architectural constraint, not a style guide. Blue belongs to care receivers, purple belongs to care providers, and the two never share a logged-in screen. Admin surfaces are neutral slate grays with no brand accent because administrators are the operator, not the audience.

- **Route groups are thematic boundaries, not just permission boundaries.** `/app/(public)`, `/app/(receiver)`, `/app/(provider)`, and `/app/(admin)` each own their theme at the layout level. A shared theme provider at `app/layout.tsx` selects the correct palette by route group; individual components do not read the theme from context directly.
- **Cross-theme component imports are rejected in review.** A `(receiver)` page that imports a component from `(provider)` - or vice versa - is a design error. Shared UI lives in `components/ui/` and is theme-agnostic (it reads CSS variables rather than hardcoded colors).
- **`/app/(public)` is the only surface where the unified mark appears.** Public marketing, sign-in, and sign-up all live in `(public)` because the audience is not yet known. Transactional emails sent before the recipient has a role also use the unified mark; every subsequent email is themed to the recipient's side.
- **Admin (`/app/(admin)`) uses `favicon-admin.svg` and a neutral slate palette.** Embedded previews of a specific receiver or provider record inside an admin screen may show the appropriate side color within a clearly-bounded preview frame, but the surrounding admin chrome stays neutral.
- **Accessibility rule:** color is never the only signal distinguishing the two sides. Every themed surface carries a persistent audience label in the header ("Care receiver", "Care provider", "Administrator") that is visible and announced by screen readers, plus distinct iconography or heading treatment. This is a WCAG 2.1 success criterion 1.4.1 requirement, not a style preference, and is enforced in W3 Playwright checks.
- **Role-addressed surfaces outside the web UI inherit the theme.** Transactional email templates, Web Push notifications, shared PDF exports, and invoices all pick the correct theme based on recipient role. A care-plan PDF rendered for a receiver uses the receiver theme; the same plan rendered for the authoring provider uses the provider theme. This rule is written into the scope of every component that produces role-addressed output.

**Observability:**

- Vercel Analytics and Logs
- Supabase logs
- Sentry for error tracking

**External Integrations (introduced per phase):**

- Phase 1: none beyond Supabase
- Phase 2: Stripe Connect (marketplace payments and platform commission), GoCardless (direct debits), Resend or Postmark (transactional email), Twilio or Supabase Auth SMS, Web Push via VAPID
- Phase 3+: calendar sync (Google, Microsoft), partner APIs

### Security & Compliance

**Data Protection:**

- GDPR and UK Data Protection Act 2018 compliance
- NHS Data Security and Protection Toolkit alignment
- Encryption for all sensitive data, in transit and at rest
- Row-Level Security policies as the primary access control boundary

**Verification & Trust:**

- Identity verification for all users
- Certification validation for providers
- Background checks integration
- Insurance verification

**Payment Security:**

- PCI-DSS compliance via Stripe Connect (no card data touches platform servers)
- Secure payment processing
- Transaction monitoring

**Accessibility & Inclusion:**

- **WCAG 2.1 AA is a legal baseline, not a goal.** The platform serves elderly users, people with disabilities, and people recovering from illness. Accessibility conformance is required under the UK Equality Act 2010 and is a launch-blocking requirement, not a Phase 3 polish item.
- Every component adopts the accessible shadcn/ui baseline and is expected to pass automated axe-core checks in Playwright plus a manual keyboard-only walkthrough before merge
- Screen reader behaviour is validated on VoiceOver (iOS, macOS) and NVDA (Windows) at least once per phase exit
- Content design uses plain English (Hemingway grade 8 or lower) because a meaningful share of receivers will have cognitive impairments
- Colour is never the sole carrier of information; focus states are visible on every interactive element; forms use explicit labels and error summaries
- **The brand receiver/provider/admin split is paired with a non-colour signal on every themed surface** (persistent audience label in the header, distinct iconography, accessible name on the installed PWA), so colourblind users, screen-reader users, and users in monochrome contexts always know which side of the platform they are on. See `docs/brand/COLORS.md` and the Brand & theming subsection under Technical Architecture for the exact rule. This is a WCAG 1.4.1 requirement, not a style preference, and is enforced by W3 Playwright checks.
- The PWA install prompt, notifications, and visit check-in flows are tested under assistive-technology conditions, not just visually

### Monetisation Strategy

- Flat 5% platform commission on all transactions at launch. The commission rate is stored per-agreement in the `commission_ledger` table rather than hardcoded, so future variability (provider tier, volume discount, promotional rate) can be introduced without a schema change. No variable-rate logic ships until a business case is signed off.
- Potential premium features for providers (enhanced visibility, priority placement) - not in scope before Phase 3
- Subscription options for care provider companies with multiple caregivers - not in scope before Phase 3

Commission infrastructure is built in Phase 2 (component C13) rather than at launch. Phase 1 deliberately contains no payment components so that the marketplace can be validated with discovery, verification, and initial contact flows before money moves.

### Cross-cutting workstreams

Some concerns touch almost every component and cannot be delivered by a single phase. They are scoped here as workstreams with a named owner and are referenced from component scopes below.

**W1. Regulatory & Trust.** Owns the care-platform compliance surface as a single named workstream, because the existing document-upload flows in C3 and C5 are not sufficient for a UK care platform on their own. In scope:

- Live DBS integration (for example, uCheck or Credas) with periodic re-verification rather than a one-off file upload
- Insurance verification API (provider public liability, employer's liability) with automated expiry alerts
- NHS Data Security and Protection Toolkit evidence collection, mapped to platform events
- CQC alignment: evidence that the platform does not itself deliver regulated activity, plus support for registered providers who do
- **Safeguarding duty (mandatory reporting).** The platform has a legal and ethical obligation to act on disclosed or observed risk of harm to vulnerable adults. W1 owns the policy (severity scale, 24-hour triage SLA, statutory escalation routes to local authority adult safeguarding boards and police where appropriate) and is implemented by component C25. Safeguarding is **not** the same as the concerns reporting box in C16; it is a regulated escalation path with named responsible persons and its own audit trail.
- Tamper-evident audit log (see W2) as the source of truth for regulatory review
- Data retention schedules per entity class (care records, financial records, messages, visit media)
- Ownership: a named compliance lead on the product team, **plus a named safeguarding lead** (may be the same person if qualified), not the engineering tech lead

W1 touches C3 (onboarding), C5 (verification console), C11 (visit records), C13 (financial records), C24 (data subject rights), and C25 (safeguarding). It is a go/no-go workstream - the platform cannot go live to paying providers in the UK without it.

**W2. Audit logging.** A shared `audit_log` table plus a server-side helper (`recordAuditEvent(actor, action, subject, before, after)`) owned by C2 and consumed by every component that mutates a regulated entity. Append-only, with hash-chained rows for tamper evidence. Referenced by C3, C5, C10, C11, C12, C13, C24.

**W3. Delivery practices.** Cross-cutting engineering standards that apply to every component:

- Playwright for end-to-end tests hitting preview deployments
- **axe-core accessibility assertions run inside every Playwright flow**; a new violation fails the build, not the deploy. Manual keyboard-only and screen-reader walkthroughs run at phase exits.
- Vitest for unit tests of Server Actions and utilities
- **pgTAP (or `supabase-test-helpers`) for RLS policy tests** - every RLS policy ships with a test that exercises allowed and denied access paths. Skipping this is the single biggest cause of data leaks in Supabase projects and is non-negotiable here
- Vercel preview deployment per PR, wired to a disposable Supabase branch for database changes
- Vercel Rolling Releases for gradual production rollout of any component that touches care records, payments, or verification
- Sentry error budget per component; regressions block rollout promotion

**Local development baseline.** Six commitments that belong in the PID because getting them wrong has architectural or compliance consequences; everything else (exact commands, Node versions, IDE config, git workflow) belongs in `CONTRIBUTING.md` once C1 creates the repo.

1. **Local Supabase stack is mandatory.** Every engineer runs the Supabase CLI local stack (`supabase start`). pgTAP policy tests require a local Postgres, and no RLS work can land without one. "Works on my laptop against prod" is explicitly banned because it is how care platforms leak data.
2. **One migration source of truth across all environments.** The local stack, the per-PR Supabase branch, and production all apply the same ordered migrations from `supabase/migrations/`. Environment-specific schema drift is not tolerated; any correction ships as a new forward migration.
3. **Synthetic seed data only - no production dumps, even anonymised.** Seed data is generated by a committed TypeScript seed script (faker, or Snaplet if adopted) that produces realistic but entirely fictional receivers, providers, care plans, visits, and payments. Anonymised production dumps are explicitly rejected because a care platform cannot carry the risk of a leaked anonymisation rule, even in staging. The seed script doubles as the baseline for Playwright fixtures.
4. **Secrets handling.** `.env.local` is gitignored and populated from a committed `.env.example` that lists every required key with a comment. Production secrets live only in the Vercel and Supabase dashboards and are never pulled onto an engineer's machine. No engineer needs production credentials to do their job because the local stack is a complete environment. Secret rotation cadence and break-glass access are defined in `CONTRIBUTING.md` and owned by the tech lead.
5. **Local HTTPS for the PWA.** Service workers, Web Push, and installability all require HTTPS even locally. The repo ships with an HTTPS dev setup (mkcert, Caddy, or Next.js experimental HTTPS) so PWA features in C1, C11, and C15 can be exercised on a developer laptop without "works in prod only" surprises.
6. **No one develops against production.** Stated explicitly because it will otherwise happen the first time a staging bug is hard to reproduce. Debugging against production data requires a DSAR-grade justification and is logged in `audit_log`.

### Implementation Phases

Phases are indexed by **component** so that each component can be built, reviewed, and, where practical, shipped in isolation by different contributors. Each component lists its scope, its dependencies on other components, and the user stories (from `docs/user_stories.md`) it satisfies. Within a phase, any two components without a dependency edge can be worked on in parallel.

Phase 1 is split into **Phase 1a (MVP)** and **Phase 1b (Launch-ready)**. Phase 1a is the smallest honest slice that lets a real receiver contact a real provider; Phase 1b adds the multi-party, verification, and compliance surface required to open the platform to paying UK users. This split exists because the previous revision of this document treated "Phase 1" as a single eight-component block, which is a full v1 rather than an MVP and hides a value-delivery checkpoint between them.

#### Phase 1a - Minimum viable discovery loop

Exit criterion: a receiver can find an individual provider, read their profile, and send a contact request that the provider can reply to via email. No companies, no family circles, no admin gate, no money.

**C1. Platform shell, design system & repo migration** - **Status: shipped (2026-04-09).**

- Next.js app scaffold at the repo root (or `apps/web/`), Tailwind, shadcn/ui, root layouts for public / provider / receiver / admin route groups, PWA manifest and service worker
- **Brand & theming baked in from day one.** Ships a two-theme design system (receiver blue, provider purple) with a third neutral-slate theme for admin, wired at route-group layout level so cross-theme imports are structurally impossible. CSS variables are resolved per route group; shared components in `components/ui/` read variables rather than hardcoded colors. The three themed favicons (`favicon-blue.svg`, `favicon-purple.svg`, `favicon-admin.svg`) are served per route group; the unified mark (`favicon-unified.svg`) is served only under `/app/(public)`. Every themed layout renders a persistent audience label in the header for the WCAG 1.4.1 secondary-signal rule.
- **PWA manifest:** single installable PWA with the unified mark on the install surface; UI themes to the correct side after login. Two-scope installables are deferred to a Phase 3 revisit.
- **Repo migration:** the existing empty `web-provider/` and `web-receiver/` scaffolds are removed as part of C1. The new platform lives in a single Next.js app; any historical content in those directories is archived under `docs/archive/` rather than carried forward.
- Depends on: nothing. Unblocks every other component.

**What actually landed in the C1 slice (2026-04-09):**

- Next.js 16.2.3 (Turbopack) + React 19.2 + Tailwind v4 + TypeScript strict, single app at repo root (not `apps/web/`).
- Four route groups with distinct URL segments: `/` in `app/(public)`, `/receiver` in `app/(receiver)/receiver`, `/provider` in `app/(provider)/provider`, `/admin` in `app/(admin)/admin`. Each themed group layout sets `data-theme` on a wrapper div and declares its own `icons` metadata so the browser tab favicon switches per side.
- Design system wired via CSS variables: `app/globals.css` declares the canvas and semantic palette plus empty `--brand-*` slots; `app/themes.css` fills those slots under `[data-theme="blue" | "purple" | "admin"]`. Shared components read `bg-brand`, `text-brand`, `ring-brand-ring` - none of them know which side they are rendering on. Admin uses a single slate gray matching `#64748b` from `docs/brand/COLORS.md`.
- Shared primitives in `components/ui/`: `button.tsx` (tailwind-variants, exports `buttonStyles` for `<Link>` usage), `audience-banner.tsx` (persistent role label with lucide icon and `aria-label` for WCAG 1.4.1), `brand-mark.tsx` (renders the correct SVG by variant). Helper `lib/cn.ts` with `clsx` + `tailwind-merge`. Shadcn CLI was intentionally not installed - scope is too small to justify the registry, and the primitives are shadcn-shaped so it can be added in C2 without rework.
- PWA manifest at `app/manifest.ts` (TypeScript metadata route) serves `favicon-unified.svg` as the install icon, because the install surface is pre-role.
- Brand assets copied from `docs/brand/assets/` to `public/brand/`.
- Structural theme-isolation guard at `scripts/check-theme-isolation.mjs` (run via `npm run check:themes`): rejects cross-group imports between `(receiver)` / `(provider)` / `(admin)` and rejects hardcoded `bg-blue-500` / `bg-purple-600` / etc. in shared components. Passes.
- Vercel project linked: `ctrl-alt-elite-uk/mycareprovider`. No `vercel.ts` yet - framework is auto-detected and the file adds noise until we need crons, rewrites, or headers. Initial `vercel deploy` deliberately deferred until the first preview is requested.
- Verified: `next build` produces 7 static pages cleanly, `next dev` serves all four routes with the correct `data-theme`, audience banner text, and favicon URL (verified via curl).

**Explicitly not in C1 (landing in later components):**

- Service worker / offline PWA - deferred beyond C1; Next 16 has no built-in SW.
- ESLint or Playwright/axe automation - W3 delivery practices, lands alongside C2.
- `vercel.ts`, crons, rewrites, Vercel BotID - added when their consumers ship (BotID with C7a, crons with C3b).
- Any auth, database, or data fetching - all C2 and beyond.

**C2. Auth, role management & shared audit log (W2 anchor)** - **Status: shipped (2026-04-09).**

- Supabase Auth wiring, `profiles` table, role JWT claim, middleware role gating, seeded super-admin migration, admin UI to invite additional admins, anonymous public browsing of the directory
- Ships the shared `audit_log` table and `recordAuditEvent` helper from W2; every component that mutates regulated state calls this helper, so it must land with C2 even though most consumers come later
- Depends on: C1
- Phase: 1a
- Covers stories 1, 2, 8, 9

**What landed (db slice):**

- `supabase/config.toml` hand-written to match Supabase CLI defaults; declares `[auth.hook.custom_access_token]` pointing at `public.custom_access_token_hook` so local dev picks the claim hook up without a dashboard round-trip. Hosted environments still need the Dashboard -> Authentication -> Hooks setting (documented in the migration header).
- `supabase/migrations/0001_profiles_and_roles.sql`: `app_role` enum (`admin | provider | provider_company | receiver | family_member`); `profiles` table with soft-delete (`deleted_at`) and `role` defaulting to `receiver`; `handle_new_auth_user` trigger on `auth.users` auto-provisions a profile row and reads `raw_user_meta_data.role` with a safe fallback; `custom_access_token_hook(event jsonb)` writes the profile role into `event.claims.app_role`.
- RLS helpers live in the dedicated `app` schema (Supabase reserves `auth` for its own service and blocks CREATE there, so the PID was updated during C2 bringup): `app.current_profile_id()`, `app.current_role()` (reads JWT claim, falls back to profiles join if the Custom Access Token hook is misconfigured). Stubs for `app.is_care_circle_member`, `app.is_company_member`, `app.is_provider_verified`, `app.can_see_care_plan` all return `false`, so any policy that calls them defaults to deny until C3a/C3b/C4/C10 ship their real bodies.
- `profiles` RLS is narrow by construction: self-select/self-update for the row owner, admin full access, plus a `profiles_public_directory` policy scoped to `role in ('provider', 'provider_company') and deleted_at is null`. Column-level grants restrict `anon` to `(id, role, display_name)`, so story 8 anonymous directory browsing works without leaking `email` or audit metadata. A `tg_profiles_guard_role` BEFORE UPDATE trigger rejects self-promotion and un-delete by non-admins (WITH CHECK alone can't see OLD). `force row level security` was deliberately not enabled so the security-definer auto-provision trigger can still insert; the risk is bounded because the owner is `postgres`, not a request role.
- `supabase/migrations/0002_audit_log.sql`: `audit_log` table with `actor_id`, `actor_role`, `action`, `subject_table`, `subject_id`, `before`, `after`, `prev_hash`, `row_hash`, `created_at`. A BEFORE INSERT trigger serialises concurrent inserters with `pg_advisory_xact_lock(hashtext('public.audit_log'))`, reads the last row's `row_hash` into `prev_hash`, and computes `row_hash = sha256(prev_hash || actor_id || actor_role || action || subject_table || subject_id || before || after || created_at)` via `pgcrypto.digest` and `convert_to(..., 'UTF8')`. RLS: INSERT allowed for authenticated users whose `actor_id` matches `auth.current_profile_id()` (or admin override, or null for system events); SELECT for the actor themselves and admins. No UPDATE policy, no DELETE policy, ever - append-only is structural, not just conventional.
- `supabase/migrations/0003_seed_super_admin.sql` is a deliberate no-op at DDL level and only defines the idempotent `public.ensure_super_admin(p_email text)` helper. Migrations can't read env vars, so the actual bootstrap lives in `supabase/seed.sql`, which calls `ensure_super_admin(current_setting('app.super_admin_email', true))` with a fallback to `admin@example.test` for local dev. Production can call the helper from a one-off SQL console session without running the synthetic seed.
- `supabase/seed.sql` seeds seven synthetic users (admin, two providers, one provider company, two receivers, one family member) directly into `auth.users`; the `on_auth_user_created` trigger creates the matching `profiles` rows from `raw_user_meta_data`. All emails use the reserved `example.test` TLD so there is zero risk of accidentally hitting a real mailbox.
- pgTAP tests at `supabase/tests/rls/profiles.test.sql` (13 assertions) and `supabase/tests/rls/audit_log.test.sql` (10 assertions) exercise allowed and denied paths on every policy, the guard trigger, the hash chain continuity, actor impersonation rejection, and the append-only discipline on updates and deletes. Tests switch identity with `set local role authenticated/anon` plus a hand-assembled `request.jwt.claims` setting so `supabase-test-helpers` is not a dependency. RLS denials on UPDATE/DELETE are asserted as "zero rows affected" (not throws) because a missing policy filters rows silently rather than raising.
- `.env.example` created at the repo root with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPER_ADMIN_EMAIL`, each with an inline comment documenting scope and security posture.

**What landed (app/runtime slice):**

- Dependencies added: `@supabase/supabase-js` and `@supabase/ssr`. No other runtime deps introduced; the audit helper and admin client sit on top of what was already in `package.json`.
- `lib/supabase/server.ts` exports `createServerClient()` built on `@supabase/ssr` and the async `next/headers` `cookies()` API. This is the canonical client for Server Components and Server Actions - the browser client in `lib/supabase/client.ts` is intentionally thin and only reached for when a Client Component genuinely needs realtime or optimistic writes.
- `lib/supabase/admin.ts` exports `createAdminClient()` using `SUPABASE_SERVICE_ROLE_KEY`. Top-of-file `import "server-only"` makes importing it from a Client Component a build error; every caller must gate on `app.current_role()` before reaching for it because it bypasses RLS.
- `lib/supabase/middleware.ts` exports `updateSession(request)` following the standard `@supabase/ssr` cookie-rotation pattern, returning `{ response, supabase, user }` so the root proxy can make role decisions without a second round-trip. `getUser()` is called to force the refresh side-effect.
- Next.js 16 renamed the middleware convention to `proxy.ts`, so the root file is `proxy.ts` exporting `proxy(request)`. It calls `updateSession()` first, then enforces: `/admin/**` requires `app_role === 'admin'`, `/provider/**` requires `provider | provider_company`, `/receiver/**` requires `receiver | family_member`. Anonymous hits on gated routes redirect to `/auth/sign-in?next=<original>`; `/` and `/auth/**` stay open for story 8 anonymous browsing. Role is read from `app_metadata.app_role` (set by the Custom Access Token hook), with a fallback that manually decodes the JWT claims so a misconfigured hosted-env hook doesn't silently lock admins out. The matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `brand/`, and any path with a file extension.
- `lib/auth/actions.ts` Server Actions (`"use server"`): `signIn`, `signUp`, `signOut`, `inviteAdmin`. `signUp` is receiver-only by construction - non-receiver roles are invite-only per story 1/2. Sign-up passes `options.data = { role, display_name }` so the db `handle_new_auth_user` trigger picks the values off `raw_user_meta_data`. `signIn` redirects by role (admin -> /admin, provider(_company) -> /provider, receiver/family_member -> /receiver), honouring a sanitised `next` param. `inviteAdmin` re-reads the caller's role from the server session (never from form input), uses the admin client's `inviteUserByEmail` with `data.role = 'admin'`, and calls `recordAuditEvent({ action: 'admin.invite', subjectTable: 'auth.users', subjectId: email, after: {...} })`.
- `lib/audit/record-audit-event.ts` is the W2 helper. Signature matches the PID. It reads the current user via `createServerClient()`, pulls the role claim, and inserts into `public.audit_log` with `actor_id`, `actor_role`, `action`, `subject_table`, `subject_id`, `before`, `after`. `prev_hash` and `row_hash` are left for the BEFORE INSERT trigger to compute. JSDoc header points at W2 and lists C3 / C5 / C10 / C11 / C13 / C24 as the near-term consumers.
- README gained a short "Local setup (Supabase)" section pointing at `.env.example` and reminding hosted environments to enable the Custom Access Token hook in the Supabase dashboard.
- Verified: `npm run build` compiles cleanly on Next.js 16.2.3 (Turbopack) with the proxy recognised ("ƒ Proxy (Middleware)" in the route table), TypeScript strict passes, and `npm run check:themes` still passes.

**What landed (ui slice):**

- `app/(public)/auth/layout.tsx` shared chrome for auth pages: centered card on the public canvas, unified brand mark (no blue or purple), link back to `/`.
- `app/(public)/auth/sign-in/page.tsx` Server Component form posting to the `signIn` Server Action. Reads `?error=` and `?next=` from `searchParams`; error summary is `role="alert"` with `tabIndex={-1}` at the top of the form and fields wire `aria-describedby` to it. Explicit `<label htmlFor>` on every input, `autoComplete` set, and the submit button keeps a visible `focus-visible` ring.
- `app/(public)/auth/sign-up/page.tsx` same shape, posts to `signUp`. No role picker by construction - the action is receiver-only, and the page copy states provider and admin accounts are invite-only so users are not encouraged to probe for a bypass. `display_name` is optional, `password` is `autoComplete="new-password"` with `minLength={8}`.
- `app/(public)/auth/sign-out/route.ts` POST-only Route Handler that calls `signOut()`. The public header renders a `<form method="post" action="/auth/sign-out">` rather than a link so prefetch and CSRF can't end a session accidentally.
- `app/(admin)/admin/users/page.tsx` minimal admin users index. Server-reads current admins from `profiles` via `createServerClient()` filtered to `role = 'admin' AND deleted_at IS NULL`, renders a table and an "Invite admin" call-to-action. Neutral slate inherited from the `(admin)` group layout.
- `app/(admin)/admin/users/invite/page.tsx` Server Component form posting to the `inviteAdmin` Server Action. Re-reads `?ok=` / `?error=` from searchParams and renders a success confirmation with links back to `/admin` and `/admin/users`, or an `role="alert"` error summary next to the form. The action itself re-derives the caller's role from the server session, so the form never sends a role hint.
- `app/(public)/layout.tsx` header updated: reads the session with `createServerClient()` and switches between anonymous ("Sign in" / "Sign up" links to `/auth/sign-in` and `/auth/sign-up`) and authenticated ("Signed in as <display_name>" plus a POST sign-out form). No hydration boundary - everything stays a Server Component.
- `components/ui/input.tsx` new shared primitive in the same shadcn-shaped style as `button.tsx`: `tailwind-variants`, reads `--color-border`, `--color-canvas`, `--color-ink`, and `--color-brand-ring` via the `brand` utilities, and paints an `aria-[invalid=true]:border-danger` error state. No hardcoded blue or purple, so `npm run check:themes` still passes, and any themed route group picks up its own brand ring automatically.
- Verified: `npm run build` compiles cleanly with the new routes visible in the Next 16 route table (`/auth/sign-in`, `/auth/sign-up`, `/auth/sign-out`, `/admin/users`, `/admin/users/invite`), and `npm run check:themes` passes.

**Environment bringup (2026-04-09):**

- Local stack booted with `supabase start` against `config.toml`; migrations 0001-0003 applied cleanly; `app` schema + six helpers verified via `docker exec` psql; super admin seeded at `admin@example.test`; `.env.local` populated from `supabase status -o env` (gitignored).
- Next dev server smoke-tested: `/` → 200, `/auth/sign-in` → 200, `/admin` → 307 to `/auth/sign-in?next=%2Fadmin` (proxy role-gating confirmed end-to-end against the local stack).
- Remote Supabase project **EAS-Andrew's Project** (`mphknmdlnwxxtazrrjmf`, West EU / Ireland) linked via `supabase link`, `major_version` bumped to 17 in `config.toml` to match the hosted Postgres, and `supabase db push` applied all three migrations to the hosted database.
- Super admin provisioned on the remote project via `POST /auth/v1/invite` with the service role key, passing `raw_user_meta_data = { role: 'admin', display_name: 'Andrew Williams' }` so the `handle_new_auth_user` trigger stamps the profile with the admin role on first sign-in. Profile row verified via PostgREST.
- Vercel env (`ctrl-alt-elite-uk/mycareprovider`) populated for Production and Development with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (marked sensitive in Production only, because Vercel forbids sensitive vars in Development), and `SUPER_ADMIN_EMAIL = apwilliams508@gmail.com`. Preview env is deferred until the first non-main branch exists: the CLI refuses to target "all preview branches" non-interactively and rejects `main` as a preview branch because it is the production branch.
- **Outstanding operator action (dashboard-only, no CLI):** enable the Auth Hook at Supabase Dashboard → Authentication → Hooks → Custom Access Token, pointed at `public.custom_access_token_hook`. Without it, JWTs will not carry the `app_role` claim and the proxy + `app.current_role()` will fall back to a per-request profiles lookup (correct result, extra query per request).

**Explicitly not in this slice:**

- Preview-environment Vercel env vars (waiting for the first feature branch).
- pgTAP test execution against the local stack (`supabase test db`) - the tests are authored and on disk; running them is a one-liner on the operator's machine.

**C3a. Individual provider onboarding & document vault** - **Status: shipped (2026-04-09).**

- Individual care provider registration, `provider-docs` Storage bucket, document upload with metadata, verification state machine (`pending | in_review | approved | rejected`)
- DBS and insurance are captured as uploaded documents only in 1a; the live-integration upgrade ships as part of C3b inside W1 and is where story 71 is actually satisfied
- Depends on: C2
- Phase: 1a
- Covers stories 5, 6

**What landed:**

- `supabase/migrations/0004_provider_onboarding.sql`: `provider_profiles` (1:1 with `profiles`, soft-deleted, admin-only `verified_at` enforced by `tg_provider_profiles_guard_verification`); `documents` with a single nullable subject FK pattern plus a `documents_exactly_one_subject` CHECK (no polymorphic `owner_type`/`owner_id`) and a `tg_documents_guard` BEFORE UPDATE trigger that freezes every column on the owner path except `deleted_at` (soft-delete is the only legal owner UPDATE, status is admin-only); `verifications` state-machine table auto-created by a security-definer `tg_documents_create_verification` AFTER INSERT trigger so owners do not need a write policy on verifications; the `app.is_provider_verified()` stub from 0001 flipped to its real body. `provider-docs` Storage bucket with policies scoped to `quarantine/<auth.uid()>/...` paths plus a narrow anon column grant on `provider_profiles` that deliberately omits `date_of_birth`, `phone`, `address_*`, and `deleted_at` to keep the public directory PII-free.
- `lib/providers/{actions,profile-actions,types}.ts` and `lib/documents/{actions,promote,mime,types}.ts` back the onboarding and document vault Server Actions. Non-async exports (types, error classes) are split into sibling modules so the `"use server"` files can import them without violating Next.js' use-server export rules. The admin-client `promote()` path moves a clean object from `quarantine/` to `clean/` and flips the document's `status` to `available`.
- UI slice: `app/(public)/auth/provider-sign-up/page.tsx` is the dedicated provider sign-up entry (receiver-only `signUp` stays at `/auth/sign-up`); it requires an explicit "I am registering as an individual care provider" confirmation before calling `signUpProvider`. The authenticated provider surface gains `app/(provider)/provider/page.tsx` (dashboard), `app/(provider)/provider/onboarding/page.tsx` (profile editor covering headline, bio, service postcode), and `app/(provider)/provider/documents/{page.tsx, upload/page.tsx, upload/actions.ts}` (document vault list + upload form that writes to the `quarantine/<uid>/...` path and records the `documents` row).
- pgTAP suites for `provider_profiles`, `documents`, `verifications`, and the storage bucket policies. Migration `0007_rls_policy_fixes.sql` landed during C8 bringup to fix one real bug (`documents_owner_read` blocking soft-delete visibility) plus two test-only cleanups; the full post-mortem lives in `docs/c3a-pgtap-fixes.md`. All nine suites / 101 assertions green.

**C6a. Provider profile (individual only)** - **Status: shipped (2026-04-09).**

- Individual provider profile (services, experience, rates); public read of approved provider profiles via RLS, draft profiles not leaked
- Depends on: C3a
- Phase: 1a
- Covers story 13

**What landed:**

- `supabase/migrations/0005_provider_services_capabilities.sql`: pure-reference tables `service_categories`, `capabilities`, `certifications` with world-read + admin-write policies and an embedded idempotent UK care-sector starter taxonomy (8 services, 9 capabilities, 8 certifications). Provider-owned linking tables `provider_services` and `provider_capabilities` are composite-PK delete-and-reinsert (no owner UPDATE policy); `provider_certifications` carries a surrogate PK and is soft-deleted with a partial unique index enforcing "at most one active row per (provider, certification type)" and a BEFORE DELETE guard that blocks hard-deletes on the non-admin path. The linking-table public_read policies gate on `verified_at` via inline `EXISTS` against `provider_profiles` (the documented one-callsite exception to the "policies are one-liners calling `app.*` helpers" rule).
- `lib/providers/catalog.ts` reads the catalog plus the caller's selection in a single parallel fan-out via `getProviderProfileWithCatalog()`; `CatalogValidationError` surfaces validation failures through the shared `?error=` trampoline.
- UI slice: three authenticated provider pickers under `app/(provider)/provider/onboarding/{services,capabilities,certifications}/{page.tsx,actions.ts}`, each a Server Component form that reads the reference taxonomy via the user-scoped client and posts back to a Server Action that performs the delete-and-reinsert for the composite-PK tables or the soft-delete-then-insert for `provider_certifications`. The onboarding index page links all three sections and surfaces the current verification state.
- pgTAP suites for each linking table exercising verified-vs-draft visibility and the soft-delete guard.

**C7a. Basic provider search** - **Status: shipped (2026-04-09).**

- Public unauthenticated provider directory with location search (Postgres `pg_trgm` plus PostGIS or earthdistance for radius) and provider profile viewer. Advanced filtering is deferred to C7b.
- **Vercel BotID** is enabled on the public directory from day one to keep scraping and automated enumeration off the search endpoint
- Depends on: C6a
- Phase: 1a
- Covers stories 18, 20

**What landed:**

- `supabase/migrations/0006_provider_search.sql`: `pg_trgm`, `cube`, and `earthdistance` extensions (chosen over PostGIS to keep extension sprawl low - radius search is the only geospatial workload C7a needs); geocoded columns (`service_postcode`, `latitude`, `longitude`, `service_radius_km`, `geocoded_at`) added to `provider_profiles` with the new public columns added to the narrow anon grant (`geocoded_at` deliberately withheld); partial GIN trigram indexes on `headline` and `bio`, and a partial GiST index on `ll_to_earth(lat, lng)` scoped to verified non-deleted rows. `app.search_providers(query, near_lat, near_lng, radius_km, service_slug, capability_slug, limit_count, offset_count)` is STABLE SECURITY INVOKER so anon RLS applies transparently; `limit_count` is capped at 100 via `least()`. A thin `public.search_providers` wrapper is the PostgREST surface because the `app` schema is deliberately off `config.toml`'s exposed list.
- `lib/search/provider-search.ts` + `lib/geo/postcode.ts` back the search form; `app/(public)/providers/page.tsx` renders the directory list and `app/(public)/providers/[id]/page.tsx` renders the profile viewer. Both are neutral-palette Server Components under the `(public)` group - no brand tokens. The viewer's queries deliberately do **not** reference `deleted_at` (the anon column grant omits it; soft-delete filtering is enforced transitively by the `public_read` RLS policies).
- `app/api/providers/search/route.ts` exposes the same RPC as an unauthenticated JSON endpoint (`runtime = "nodejs"`, `dynamic = "force-dynamic"`). It wraps `botid/server`'s `checkBotId()` in a dynamic import with a dev/preview fallback that logs once and lets the request through; the TODO to flip this to a hard-fail ships with the C7a production-launch gate, not with the feature PR. The endpoint never reaches for the admin client, so RLS on `provider_profiles` is still the authoritative filter.
- Two demo providers (London dementia specialist, Manchester live-in/companionship) seeded via `supabase/seed.sql` so `/providers` has content straight after a `supabase db reset`.
- `proxy.ts` routing bug found and fixed during bringup: the role-gate rule used `pathname.startsWith(r.prefix)`, so `/providers` matched the `/provider` rule and bounced logged-in receivers to sign-in. Fix is a strict segment match: `pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)`.

**C8. Initial contact, meeting scheduling & lightweight messaging bridge** - **Status: shipped (2026-04-09).**

- Contact-request table, provider response workflow, meeting proposal flow, transactional email notifications (Resend or Postmark)
- **Minimal messaging bridge:** after a contact request is accepted, C8 opens a thin, non-realtime `contact_threads` table that both parties can post into from the web UI, with every new post mirrored to email. This eliminates the dead-end in the user journey between "meeting scheduled" and "C9 realtime messaging ships in Phase 2". When C9 lands, existing `contact_threads` are migrated into `conversations` and the bridge is retired.
- **Abuse controls:** Vercel BotID on the unauthenticated contact-request endpoint; per-receiver rolling rate limit on contact-request creation (for example, N per hour per account and M per IP); per-thread rate limit on thread posts. Counters live in `rate_limit_buckets`. Abuse controls are a launch-blocking requirement for C8, not a Phase 3 hardening item.
- **Themed surfaces:** contact-request UI in the receiver's blue theme, provider response UI in purple; every email is themed by recipient role (blue to receivers, purple to providers). Pre-role sign-up confirmations use the unified mark.
- Depends on: C2, C7a
- Phase: 1a
- Covers stories 21, 22, 23, 82

**What landed:**

- `supabase/migrations/0008_contact_messaging.sql` ships five tables - `contact_requests`, `meeting_proposals`, `contact_threads`, `contact_thread_posts`, `rate_limit_buckets` - plus the shared `app.bump_rate_limit(scope, window, max)` SECURITY DEFINER helper. Every status-transition rule lives in a guard trigger (`tg_contact_requests_guard`, `tg_meeting_proposals_guard`) rather than a WITH CHECK clause because RLS cannot compare OLD to NEW; the triggers also stamp `responded_at` on the transition so Server Actions never have to remember to set it.
- **Database-enforced invariant, not an app convention:** `contact_threads` has zero INSERT policy and zero INSERT grant for `authenticated`. The only legal way to open a thread is the AFTER UPDATE SECURITY DEFINER trigger `tg_contact_requests_open_thread` on `contact_requests`, which fires exactly when a request transitions `pending -> accepted`. A `UNIQUE (contact_request_id)` index guarantees one thread per request even under concurrent accepts. `contact_thread_posts` is likewise append-only from user code: no UPDATE / DELETE grant, no `updated_at` column, and the posts migrate into `conversations` in C9 with their immutability preserved.
- `meeting_proposals.meeting_at` is enforced in the future by a BEFORE INSERT trigger (`tg_meeting_proposals_future_only`) because a CHECK constraint cannot reference `now()`. The status state machine allows the proposer to `cancel` only, and the counter-party (the other side of the underlying `contact_requests` row) to `accept`, `decline`, or `cancel`; `proposed` is terminal in both directions once it leaves that state.
- **`rate_limit_buckets` is a side channel, not a readable table.** RLS is enabled with **zero policies and zero grants** for `anon` + `authenticated`. All access goes through `app.bump_rate_limit()`, which takes a per-`(profile, scope)` advisory xact lock, aligns the window to a deterministic epoch boundary, upserts against `UNIQUE (profile_id, scope_key, window_start)`, and `raise`s SQLSTATE `P0001` with message `rate_limited` when the count exceeds the cap. PostgREST surfaces the code and message; `lib/contact/actions.ts:isRateLimited()` matches on both.
- **Known C8 gap (not a bug, tracked in-file):** `app.bump_rate_limit` lives in the private `app` schema and is therefore not reachable from PostgREST. The only wire-up that bites today is the BEFORE INSERT trigger on `contact_thread_posts` (`thread_post.create`, 30 per 60 s). Rate-limiting `contact_request.create` and `meeting_proposal.create` from the Server Action path requires a thin `public.*` wrapper in a follow-up migration; `lib/contact/actions.ts:289` and the migration header both mark this as a TODO. Vercel BotID on the public directory endpoint is the first line of defence in the interim per the C7a / C8 abuse-control baseline.
- pgTAP suites for all four relational tables (`contact_requests.test.sql`, `contact_threads.test.sql`, `contact_thread_posts.test.sql`, `meeting_proposals.test.sql`) exercising the party-visibility policies, the guard-trigger transition rules, the admin override, and the append-only discipline on posts. Rate-limit behaviour is covered via the post insert path.
- `lib/contact/{actions,queries,types}.ts` expose six Server Actions: `sendContactRequest`, `withdrawContactRequest`, `respondToContactRequest`, `proposeMeeting`, `respondToMeeting`, and `postToThread`. Every mutation reads the caller via the user-scoped Supabase client (never the admin client), lets RLS + the guard triggers be the authoritative gate, and writes a W2 `recordAuditEvent` call with a **redacted** payload - `subject` and status transitions are audited, `body` / `response_note` / post text are PII and never land in the audit log.
- `lib/notify/{email,templates}.ts` is a fire-and-forget transactional email wrapper. When `RESEND_API_KEY` is set it **dynamically** imports `resend` (deliberately not in `package.json` so local dev stays lean) and sends through it; when absent it logs `[email dev]` and appends to an in-memory `__devOutbox` the test harness can assert on via `__getDevOutbox()` / `__clearDevOutbox()`. Failures are logged and swallowed - email delivery is launch-blocking at the UX level but must not abort the database transaction. The `from` address is themed by recipient role (`receiver@`, `provider@`, `admin@` on `notifications.mycareprovider.test` as a placeholder hostname) so the "Role-addressed surfaces" rule from the Brand & theming section is enforced at the SMTP envelope, not just in the body.
- UI slice under the two authenticated route groups: `app/(receiver)/receiver/contacts/{page,_actions,new/page,[id]/page}.tsx` for the receiver outbox, compose form, and thread view; `app/(provider)/provider/contacts/{page,_actions,[id]/page}.tsx` for the provider inbox and thread view. Compose forms and thread viewers render in the caller's themed route group, matching the "contact-request UI in blue, provider response UI in purple" rule. The `_actions.ts` co-located with each page is a thin route-scoped Server Action wrapper that calls into `lib/contact/actions.ts` and handles the redirect trampolines; the heavy lifting stays in `lib/contact/`.

**C9a. Receiver account creation (receiver self-serve only)** - **Status: shipped via C2 (2026-04-09).**

- Care receiver accounts without family-circle or authorisation flows; stories 10-12 are deferred to C4 in Phase 1b
- Depends on: C2
- Phase: 1a
- Covers (partial) story 9 already in C2; no additional stories
- **What landed:** no standalone component. C2's receiver-only `signUp` Server Action at `/auth/sign-up` already satisfies the scope; the provider sign-up entry point lives at the parallel `/auth/provider-sign-up` route added under C3a. There is deliberately no separate C9a migration, Server Action, or route group - adding one would duplicate C2. Retained as a PID entry only to keep the story-coverage map honest.

Phase 1a exit is the first externally visible checkpoint and the first time Rolling Releases are used in production.

**Phase 1a bug hunt (2026-04-10).** Before Phase 1a was marked exit-ready, a four-agent audit swept C1-C9a and produced 71 findings across four reports under `docs/bug-hunt/` (`auth-findings.md`, `rls-findings.md`, `storage-findings.md`, `contact-findings.md`). A four-agent fix team then landed the cleanup in a single pass; the substantive bugs worth remembering are:

- **Role-escalation class (7 critical findings collapsed into one fix).** The `handle_new_auth_user` trigger trusted `raw_user_meta_data.role`, and every TypeScript role gate (proxy, Server Actions, audit writer) fell back to the writable `user_metadata.role`. A user could self-elect to admin and reach `inviteAdmin` + the service-role key. Fix landed as: trigger coerces any non-`receiver` role to `receiver` unless `raw_app_meta_data.invited_by` is set (migration 0009), and a shared `lib/auth/current-role.ts:getCurrentRole()` reads `profiles.role` via the user-scoped client. Every call site now routes through it. `user_metadata.role` is no longer read anywhere.
- **Audit-log forgery.** `audit_log_insert_authenticated` allowed `actor_id IS NULL` rows from any authenticated user, which is the sentinel the codebase uses for "system" events. Fixed by dropping the null-actor branch and adding `app.record_system_audit(...)` SECURITY DEFINER helper granted only to `service_role`; the TS `recordAuditEvent({ system: true })` path now calls the RPC through `createAdminClient`.
- **Quarantine-to-available promote had no scan gate.** `promoteQuarantinedDocument` flipped `status='available'` with no virus verdict. Phase 1a does not ship a scanner, so the fix is structural: `PromoteOptions.scanVerdict: 'clean'` is now required and no call site supplies it, disabling the reachable promote path until C-scanner lands. `reconcileQuarantinedDocuments()` helper scans for dangling objects; magic-byte MIME sniffing (`lib/documents/sniff.ts`) now runs at upload time and persists the sniffed mime.
- **Service-postcode exfiltration.** `updateProviderProfile` fell back the provider's personal `postcode` into `service_postcode` (exposed to anon via `provider_profiles_public_read`), leaking the provider's home address. Fix: when `service_postcode` is null/empty, `latitude`, `longitude`, `geocoded_at` are nulled out too, and the anon column grant on `provider_profiles` no longer includes `latitude`, `longitude`, `service_postcode`. The public search RPC returns `distance_km` only.
- **Contact surface abuse controls.** Rate limiting for `contact_request.create` and `meeting_proposal.create` was documented but never wired (TODOs in `lib/contact/actions.ts`). Migration 0009 adds per-profile `BEFORE INSERT` rate-limit triggers; a new `app/api/contact/create/route.ts` Route Handler fronts the receiver contact form with a Vercel BotID gate (hard-fail in production, soft in dev) and a per-IP in-memory bucket layered on top. `tg_contact_thread_posts_rate_limit` was rewritten to include `thread_id` in the scope key and moved to AFTER INSERT. CRLF header injection via subject/display_name is now caught by `lib/notify/sanitize.ts:sanitizeHeader()` at the form boundary and again at the template boundary.
- **Cross-party email silently dropped.** Provider->receiver notification emails looked up the peer's email via the user-scoped client, which RLS correctly blocks; emails were never sent. Fix: `lookupEmail()` now uses `createAdminClient()` scoped to a single-row read, with a comment noting it is only reachable after full authorisation.
- **Proxy matcher and open redirect.** The Next.js matcher excluded any path containing a dot (so `/admin/users/export.csv` bypassed the role gate entirely); `?next=//evil.com/path` on `/auth/sign-in` was a working open redirect. Matcher tightened to a known static-extension allow-list with explicit `/admin/:path*`, `/provider/:path*`, `/receiver/:path*` entries; `next` is now validated with `/^\/[^/\\]/`.
- **Soft-delete re-censor.** `documents_owner_read` had lost its `deleted_at IS NULL` filter during an earlier refactor, and `provider_certifications` had no guard against non-admin undelete. Both restored in 0009; soft-delete now goes through `app.soft_delete_document(uuid)` SECURITY DEFINER to avoid the "updated row must remain visible" RLS gotcha.

Full finding-by-finding status lives in `docs/bug-hunt/*.md`. All 71 findings are addressed or explicitly punted with a PID-recorded reason; the single deferred item is the actual scanner integration (tracked under the existing C-scanner entry for Phase 1b).

#### Phase 1b - Launch-ready

Exit criterion: verified providers and provider companies can be onboarded, family members can manage care on behalf of receivers, administrators can approve or reject documentation, DSAR and erasure flows are operational. The platform is legally and operationally ready to open to paying UK users, even though payments themselves are still deferred to Phase 2.

**C3b. Provider companies & live trust integrations (W1)** - **Status: shipped (2026-04-10), stories 3/4/7 only. Live integrations (71, 72) deferred to W1 workstream.**

- Provider company registration, company documentation upload, association of individual providers with a company
- Live DBS integration (uCheck or Credas), insurance verification API, document expiry alerts via Vercel Cron
- Depends on: C3a
- Phase: 1b
- Covers stories 3, 4, 7, 71, 72

**What landed:**

- `supabase/migrations/0012_provider_companies.sql`: `provider_companies` table (1:1 with `profiles` where `role='provider_company'`), same guard-trigger pattern as `provider_profiles` (verified_at/undelete admin-only); `company_memberships` table linking individual providers to companies with role enum (`owner | admin | member`), partial unique index on active memberships per (company, provider); real body for `app.is_company_member()` replacing the 0001 stub; FK upgrade on `documents.provider_company_id`; `documents_owner_insert` policy extended to allow company uploads; `documents_company_read` policy so company members can read company docs; narrow anon column grant on `provider_companies` excluding phone and registered_address.
- `lib/companies/{actions,queries,types}.ts` and `lib/companies/upload.ts`: `signUpCompany`, `updateCompanyProfile` (with geocoding), `inviteMember`, `acceptInvitation`, `removeMember`, `uploadCompanyDocument`. All mutations call `recordAuditEvent`.
- `app/(public)/auth/company-sign-up/page.tsx`: dedicated company registration form following the provider-sign-up pattern; role set server-side, never from user input.
- UI under `app/(provider)/provider/company/`: dashboard with setup checklist (`page.tsx`), profile editor (`profile/page.tsx`), member management with invite/remove (`members/page.tsx`), document vault with upload flow (`documents/page.tsx`, `documents/upload/page.tsx`). All in purple theme.
- pgTAP tests (18 assertions): anon directory read, narrow column grant, owner self-read/update, guard trigger rejection, membership visibility, `is_company_member` helper, admin verify/soft-delete.

**C4. Receiver family circles & authorisation** - **Status: shipped (2026-04-10).**

- Family member accounts, power-of-attorney and other authorisation document upload, `care_circles` membership table with invitation flow, additional family member add flow
- Depends on: C2, C9a
- Phase: 1b
- Covers stories 10, 11, 12

**What landed:**

- `supabase/migrations/0011_family_circles.sql`: `care_circles` table (one per receiver, unique constraint on `receiver_id`); `care_circle_members` with partial unique index on active members; `family_authorisations` with admin-only `verified_at` guard trigger; `family_invitations` table for email-based invite flow (7-day expiry, token-based); real body for `app.is_care_circle_member()` replacing the 0001 stub (returns true for active members or the owning receiver); `receiver-docs` storage bucket with quarantine pattern matching `provider-docs`; expanded `documents.kind` CHECK to include `'authorisation'`.
- Full RLS on all tables: circle-member scoped reads, receiver/primary write access, admin full access. Anon can read unexpired invitations (needed for the public sign-up acceptance page).
- `lib/care-circles/{actions,queries,types}.ts`: `createCareCircle`, `inviteFamilyMember`, `acceptInvitation`, `removeMember`, `uploadAuthorisationDocument`, `signUpFamilyMember`. The family sign-up uses the admin client with `app_metadata.invited_by` so migration 0009's role coercion honours the `family_member` role. All mutations call `recordAuditEvent`.
- UI routes: `/receiver/family` (circle overview with member list), `/receiver/family/invite` (invite form), `/receiver/family/[memberId]` (member detail with authorisation doc upload), `/auth/family-invite` (public invitation acceptance + sign-up page). All receiver routes in blue theme.
- pgTAP tests (24 assertions) covering all RLS policies, guard triggers, `is_care_circle_member`, and unique constraints.

**C5. Admin verification console**

- Admin-only routes to review provider documentation, company documentation, and family authorisation; approve or reject with notes; every action recorded in `audit_log` via W2
- Lives under `/app/(admin)` and therefore renders in the neutral slate admin theme with `favicon-admin.svg`; embedded previews of a specific provider or receiver record may show the appropriate side colour within a bounded preview frame
- Depends on: C3a, C3b, C4
- Phase: 1b
- Covers stories 16, 17

**What landed:**

- `supabase/migrations/0014_admin_verification.sql`: query-path indexes only (no new tables needed). Partial indexes on `verifications(state, created_at)` for pending/in-review queue, `provider_profiles(created_at)` for unverified providers, `provider_companies(created_at)` for unverified companies, `family_authorisations(created_at)` for unverified authorisations, and `documents(status, created_at)` for quarantined docs.
- `lib/admin/verification-queries.ts`: `getVerificationStats` (counts across all four queues), `getPendingVerifications`, `getDocumentForReview`, `getPendingProviders`, `getProviderForReview`, `getProviderDocuments`, `getPendingCompanies`, `getCompanyForReview`, `getCompanyDocuments`, `getPendingFamilyAuthorisations`, `getFamilyAuthorisationForReview`. Every query gates on `getCurrentRole() === 'admin'`.
- `lib/admin/verification-actions.ts`: `reviewDocument` (approve/reject document verification with notes), `verifyProvider` (stamp `provider_profiles.verified_at`), `verifyCompany` (stamp `provider_companies.verified_at`), `verifyFamilyAuthorisation` (stamp `family_authorisations.verified_at` and `verified_by`). All actions gate on admin role, use `createAdminClient()` for writes, and call `recordAuditEvent` with redacted before/after state.
- UI routes: `/admin/verification` (dashboard with queue counts), `/admin/verification/providers` (pending providers + pending document verifications), `/admin/verification/providers/[id]` (provider profile review with documents table + verify action; document review with approve/reject form and notes), `/admin/verification/companies` (pending companies list), `/admin/verification/companies/[id]` (company detail review + verify action), `/admin/verification/family` (pending family authorisations), `/admin/verification/family/[id]` (authorisation detail with attached document + verify action). All routes in neutral slate admin theme.
- Updated admin home page with link to verification queue.

**C6b. Company & receiver needs profiles**

- Provider company profile (team, services, capabilities), receiver needs profile
- Depends on: C3b, C4
- Phase: 1b
- Covers stories 14, 15

**What landed:**

- `supabase/migrations/0013_company_receiver_profiles.sql`: `mobility_level` enum; `company_services` and `company_capabilities` composite-PK linking tables (mirroring `provider_services`/`provider_capabilities` from 0005) with public-read gated on `provider_companies.verified_at`, owner insert/delete, admin full access; `receiver_profiles` table with self-read/update, care-circle-member read via `app.is_care_circle_member`, admin full access, zero anon access. Geocoding columns on receiver_profiles for postcode-based matching.
- `lib/companies/profile-actions.ts`: `setCompanyServices`, `setCompanyCapabilities` (delete-and-reinsert pattern matching `lib/providers/profile-actions.ts`), `getCompanyProfileWithCatalog`. All mutations call `recordAuditEvent`.
- `lib/receivers/{types,queries,actions}.ts`: `ReceiverProfileRow` and `MobilityLevel` types, `getReceiverProfile`, `getReceiverProfileForCircle`, `upsertReceiverProfile` (with postcode geocoding via `lib/geo/postcode.ts`). All mutations call `recordAuditEvent`.
- UI routes (purple theme): `app/(provider)/provider/company/services/page.tsx` (service picker), `app/(provider)/provider/company/capabilities/page.tsx` (capability picker). Company dashboard checklist extended with services and capabilities rows.
- UI routes (blue theme): `app/(receiver)/receiver/profile/page.tsx` (needs profile editor with care needs, preferences, mobility, communication, dietary, medical summary, postcode), `app/(receiver)/receiver/profile/view/page.tsx` (read-only view).

**C7b. Advanced provider filtering** - **Status: shipped (2026-04-10).**

- Filtering by gender, certifications, capabilities, rate bands; filter combinations persisted in URL for shareability
- Depends on: C6a, C7a
- Phase: 1b
- Covers story 19

**What landed:**

- `supabase/migrations/0010_advanced_filtering.sql`: added `gender` column to `provider_profiles` with CHECK constraint (`female | male | non_binary | prefer_not_to_say`); granted gender to anon/authenticated; added indexes for gender and `hourly_rate_pence` filtering. Replaced the single-slug `search_providers` signature with a new version accepting `filter_services text[]`, `filter_capabilities text[]`, `filter_certifications text[]` (all ALL-match semantics), `filter_gender text`, `filter_rate_min int` / `filter_rate_max int` (pence). Both `app.search_providers` and `public.search_providers` wrapper updated with matching signatures. Maintained SECURITY DEFINER and all existing clamping/escaping from 0009.
- `lib/search/filter-options.ts` (new): fetches available services, capabilities, certifications from reference tables; provides static gender options for the UI.
- `lib/search/provider-search.ts`: extended `ProviderSearchFilters` with `serviceSlugs[]`, `capabilitySlugs[]`, `certificationSlugs[]`, `gender`, `rateMinPence`, `rateMaxPence`. Backwards-compatible with legacy single-slug params. Added gender to result type.
- `app/(public)/providers/page.tsx`: collapsible "Advanced filters" panel with gender select, rate range inputs, and checkbox groups for services/capabilities/certifications. All filters persisted in URL search params (shareable/bookmarkable). Accessible fieldsets, legends, labels, and keyboard navigation. Neutral theme only.
- `app/api/providers/search/route.ts`: updated to pass through all new filter params.
- `supabase/seed.sql`: added gender values to seed provider profiles for dev testing.

**C24. Data subject rights (DSAR & erasure)**

- Self-service data export endpoint producing a machine-readable bundle of every row the requesting user is the subject of
- Erasure request flow (soft-delete with a 30-day cool-off, then hard delete honouring legal retention holds on care and financial records)
- Admin console surface to triage and fulfil DSAR and erasure requests within statutory deadlines
- Non-optional under UK GDPR: this is the reason DSAR is in Phase 1b rather than Phase 3 where "Export and Import Capabilities" originally lived. Story 58 remains owned by C19 for *operational* export/import; C24 owns *data subject rights* specifically.
- The self-serve export and erasure entry points for receivers and providers live under their respective themed route groups; the admin triage queue lives under `/app/(admin)` in neutral slate
- Depends on: C2, C5 (admin surface), W2 (audit of every access and deletion)
- Phase: 1b
- Covers stories 73, 74

**What landed:**

- `supabase/migrations/0016_dsar_erasure.sql`: `dsar_requests` table (uuid PK, requester FK, request_type CHECK access/erasure, status CHECK pending/processing/completed/rejected, download_url, download_expires_at, rejection_reason, notes, deleted_at soft-delete) with unique partial index enforcing one pending request per user per type; `erasure_requests` table (uuid PK, FK to dsar_requests, requester FK, status CHECK pending_cooloff/cooloff_expired/processing/completed/cancelled, cooloff_ends_at defaulting to now()+30 days, legal_holds jsonb). Full RLS on both tables: requester self-read/insert, admin full access and update. Private `dsar-exports` storage bucket for export bundles accessed via signed URLs.
- `lib/dsar/export.ts`: `generateDataExport(profileId)` collects all user data across 14 table queries in parallel using the admin client - profiles, provider_profiles, provider_companies, company_memberships, receiver_profiles, care_circles, care_circle_members, family_authorisations, documents (metadata only), contact_requests (sent and received), contact_threads, contact_thread_posts, and audit_log entries. Returns a structured JSON bundle with `exported_at` timestamp.
- `lib/dsar/queries.ts`: `getMyDsarRequests`, `getMyErasureRequests` (user-scoped via RLS), `getErasurePreview` (shows what will be erased vs retained with statutory reasons).
- `lib/dsar/actions.ts`: `requestDataExport` (creates DSAR access request, generates export bundle, uploads to `dsar-exports` bucket, creates 7-day signed URL, auto-completes), `requestErasure` (creates DSAR erasure request + erasure_requests row with 30-day cool-off), `cancelErasure` (user cancels during cool-off). All three call `recordAuditEvent`.
- `lib/admin/dsar-actions.ts`: `processDsarRequest` (admin marks processing/completed/rejected with optional rejection reason), `processErasure` (admin triggers soft-delete cascade across all regulated tables after cool-off, stamps legal holds for audit_log and safeguarding records), `getPendingDsarRequests`, `getDsarRequestForReview`. All admin actions gate on `requireAdmin()` + `createAdminClient()` and call `recordAuditEvent`.
- `app/(admin)/admin/dsar/page.tsx`: DSAR queue split into data-export and erasure sections with status badges, requester names, and review links. `app/(admin)/admin/dsar/[id]/page.tsx`: individual request review with full detail dl, erasure-specific panel showing cool-off countdown and legal holds, admin action forms (mark processing/completed/rejected, process erasure with danger-styled button).
- `app/(receiver)/receiver/settings/data/page.tsx`: receiver DSAR hub in blue theme with export-request form, export history table with download links and expiry, erasure section with cool-off status and cancel form, erasure history table. `app/(provider)/provider/settings/data/page.tsx`: identical for providers in purple theme.
- All mutations call `recordAuditEvent` per W2. Soft-delete cascade in `processErasure` covers contact_thread_posts, contact_requests, care_circle_members, company_memberships, documents, provider_profiles, provider_companies, receiver_profiles, family_authorisations, care_circles, and profiles. Audit log is never deleted (append-only). Safeguarding records (C25) are exempt.
- Build passes cleanly on Next.js 16 (Turbopack) with all routes compiled.

**C25. Safeguarding escalation (W1)**

- Confidential "raise a safeguarding concern" entry points from every authenticated context (receiver, family member, provider, admin) and a public entry point reachable without login for reporters who do not have an account
- `safeguarding_reports` entity (see Core Domain Model) with severity scale (`information | low | medium | high | immediate_risk`), 24-hour triage SLA for `medium` and above, immediate-notification fan-out to the safeguarding lead for `high` and `immediate_risk`
- Admin queue with assignment, evidence attachment, statutory-escalation decision and justification (local authority adult safeguarding board, police, CQC where applicable), resolution notes
- Every state change on a safeguarding report is written to `audit_log` via W2 with elevated retention; safeguarding records are **not** subject to C24 erasure and are exempt in the erasure cool-off logic
- Reads are restricted to the safeguarding lead, delegated safeguarding reviewers, and the reporter themselves; RLS policies for this entity are reviewed by two engineers not one
- Explicitly separate from C16 (ratings, reviews, concerns). C16 is a customer-satisfaction channel; C25 is a regulated escalation path and mis-routing between them is a policy violation
- Submission entry points render in the reporter's themed route group (receiver blue, provider purple, or public unified for anonymous reports); the safeguarding triage queue lives under `/app/(admin)` in neutral slate
- Depends on: C2, C5, W1, W2
- Phase: 1b
- Covers stories 76, 77

**What landed:**

- `supabase/migrations/0015_safeguarding.sql`: four new enums (`safeguarding_subject_type`, `safeguarding_severity`, `safeguarding_status`, `safeguarding_event_type`); `safeguarding_reports` table (append-only, no `deleted_at`, exempt from C24 erasure) with severity scale, triage deadline, status state machine, and `updated_at` trigger; `safeguarding_report_events` table (append-only timeline, INSERT-only for admins, no UPDATE/DELETE). RLS: INSERT for authenticated + anon on reports; SELECT restricted to reporter (own reports), assigned reviewer, and admins - the subject of a report cannot see it; UPDATE on reports for admin only (status transitions). Events follow parent report visibility. Indexes on status, severity, reporter, assigned reviewer, and triage deadline.
- `lib/safeguarding/types.ts`: TypeScript types for all four enums, row interfaces for reports and events, label maps for severity/status/event types.
- `lib/safeguarding/actions.ts`: `submitSafeguardingReport` (works for authenticated and anonymous users via admin client, sets 24h triage deadline for medium+ severity, audit-logs with redacted payload), `triageReport` (admin sets severity/assigns reviewer, creates triage event), `addReportEvent` (admin adds notes/assignment changes), `escalateReport` (records statutory escalation target and justification), `resolveReport` (admin resolves with notes). All mutations write to `audit_log` via W2.
- `lib/safeguarding/queries.ts`: `getMySafeguardingReports` (reporter's own, RLS-scoped), `getPendingSafeguardingReports` (admin queue sorted by triage deadline), `getSafeguardingReport` (full report with events timeline), `getSafeguardingStats` (counts by status/severity, overdue triage count).
- UI submission forms: `app/(receiver)/receiver/safeguarding/page.tsx` (blue theme), `app/(provider)/provider/safeguarding/page.tsx` (purple theme), `app/(public)/safeguarding/page.tsx` (unified mark, no auth required for anonymous reports). All forms include guidance text distinguishing safeguarding from general complaints, severity picker, emergency contacts.
- Admin triage: `app/(admin)/admin/safeguarding/page.tsx` (queue with severity badges, overdue triage warnings, stat cards), `app/(admin)/admin/safeguarding/[id]/page.tsx` (full report review with events timeline, triage/assign/escalate/resolve action forms, statutory escalation targets including local authority safeguarding board, police, CQC). Neutral slate theme.
- Updated admin home page with safeguarding queue link.

Phase 1 (1a + 1b) explicitly excludes: Stripe and GoCardless, care plan documents, visit tracking, rich realtime messaging, medication management. Phase 1 includes accessibility conformance (story 75) as a cross-cutting requirement on every component rather than a discrete deliverable.

#### Phase 2 - Care delivery & monetisation

**C9. Realtime secure messaging**

- `conversations` and `messages` tables, Supabase Realtime subscriptions, per-conversation RLS, attachment sharing via `care-plan-attachments` bucket, emergency alert fan-out to care circle
- Includes a one-shot migration that copies existing `contact_threads` rows from the C8 messaging bridge into `conversations`, then retires the bridge
- Inherits the C8 abuse-control conventions: per-user rolling message rate limits via `rate_limit_buckets`, attachment MIME allow-list, and the shared virus-scan quarantine flow
- **Themed surfaces:** the conversation view is rendered in the viewer's theme (a receiver sees the thread in blue, a provider sees the same thread in purple). Email and push fallbacks for unread messages are themed by recipient role.
- Depends on: C2, C8
- Covers stories 35, 36, 37, 38

**C10. Care plan management**

- Versioned care plans with an append-only `care_plan_versions` table (full snapshots, not diffs), approval workflow for receivers and family, transparent per-line-item pricing, PDF export
- **Visit media consent capture.** The care-plan approval step requires the receiver (or authorised family member) to explicitly opt in or out of allowing the provider to capture photos or video during visits. The decision is recorded as a consent record on the approved `care_plan_versions` snapshot and cannot be changed retroactively - a new version must be approved to change it. C11 enforces this consent before any media upload is permitted.
- **Themed PDF exports:** the same care plan rendered for a receiver uses the receiver theme and `favicon-blue.svg`; the same plan rendered for the authoring provider uses the provider theme and `favicon-purple.svg`. The PDF renderer takes the recipient role as an input, not the plan's author.
- Depends on: C6
- Covers stories 26, 27, 28, 29, 30, 78

**C11. Visit scheduling, GPS check-in, documentation**

- Visit schedule derived from care plan cadence, mobile-friendly check-in page using browser geolocation, visit notes and media upload, receiver and family verification view
- **Visit media is category-1 risk data and is treated accordingly:**
  - Media upload is blocked entirely unless the active `care_plan_versions` record carries a positive consent record from C10. The consent check runs server-side on every upload attempt; the client UI is not the enforcement boundary.
  - Uploads are written to the `visit-media` bucket with a `care_plan_version_id` and `visit_id` stamped on object metadata so retention and RLS can key off them.
  - A scheduled job (Vercel Cron) deletes visit media at the shortest legally permissible retention window per the W1 retention schedule. Media can be placed on a safeguarding hold by C25 which exempts specific objects from automatic deletion until the hold is released.
  - Reads are restricted via RLS to the care circle plus safeguarding reviewers. The media bucket is private; access is only via signed URLs issued from Server Actions that re-check RLS eligibility at issue time.
  - Face-blur or still-only capture modes are an option the receiver can set at consent time for additional protection.
- **iOS PWA risk:** browser geolocation and Web Push on iOS Safari are only reliable when the PWA is installed to the home screen, and background geolocation is effectively unavailable. C11 ships with an in-app "check-in must be done on arrival, with the app in the foreground" flow rather than relying on background tracking. If field testing shows this is insufficient, the fallback is a thin Capacitor or Expo shell wrapping the existing Next.js surfaces - not a native rewrite. See the Risks & Mitigation section.
- Depends on: C10
- Covers stories 31, 32, 33, 34, 79

**C12. Medication management**

- Medication schedules attached to care plans, administration log with timestamps, change notifications via C9, email, and web push
- Depends on: C10
- Covers stories 39, 40, 41

**C13. Payments & commission (Stripe Connect)**

- Stripe Connect Express onboarding for providers, platform-fee wiring for the 5% variable commission, invoice generation from visit and care plan data, payment history, refund path
- Built as a Vercel Workflow DevKit durable workflow so that webhook, invoice, payout, and ledger steps survive crashes, retries, and async callbacks
- Depends on: C10, C11
- Covers stories 24, 42, 43, 44, 45

**C14. Direct debits (GoCardless)**

- GoCardless mandate capture for recurring care, reconciliation against invoices from C13
- Depends on: C13
- Covers story 25

**C26. Dispute resolution**

- Unified `disputes` entity covering three distinct flows: care-visit disputes (did the visit happen as agreed?), care-plan disputes (does the work being delivered match the approved plan?), and payment disputes (invoice, refund, or Stripe chargeback correspondence)
- Structured submission flow from receivers, family members, and providers with evidence attachment (messages, visit records, media subject to existing consent rules)
- Admin dispute queue with assignment, append-only `dispute_events` timeline, ability to issue refunds and fee adjustments through C13, and ability to suspend a provider from search via a verification-state transition in C3
- Published SLA for acknowledgement and resolution, measured via C18 analytics
- Explicitly separate from C25 safeguarding: if a dispute triage reveals a safeguarding concern, it must be escalated into a `safeguarding_report` in C25 rather than handled inside the dispute flow
- Required for Phase 2 exit because opening the platform to real payments without a dispute path is not defensible
- Submission entry points render in the submitter's themed route group; the admin dispute queue lives under `/app/(admin)` in neutral slate
- Depends on: C13, C5, C25 (for escalation), W2
- Phase: 2
- Covers stories 80, 81

#### Phase 3 - Optimisation, matching, mobile

**C15. PWA mobile experience (provider and receiver)**

- Installable PWA for both provider and receiver personas using the same Next.js codebase: home-screen install, offline shell, background sync for visit notes, Web Push via VAPID
- Replaces the native Flutter apps originally proposed; stories 46 and 47 are satisfied by delivering the existing Next.js surfaces as an installable mobile-optimised PWA rather than a separate app
- **Single PWA manifest with the unified mark on the install surface** (decision locked in C1); in-app UI themes to the correct side after login. Web Push notifications are themed by recipient role (blue badge for receivers, purple for providers, neutral slate for admin-to-admin) and carry the correct audience label in the accessible name for WCAG 1.4.1.
- Depends on: C1, C9
- Covers stories 46, 47, 48

**C16. Ratings, reviews & concerns reporting.** Depends on C11. Covers stories 49, 50, 51.

**C17. Smart matching & availability matching.** Depends on C6, C7. Covers stories 52, 53.

**C18. Analytics dashboards (provider, admin, care outcomes).** Depends on C11, C13. Covers stories 54, 55, 56.

**C19. Calendar sync, data export, partner API.** Depends on C11. Covers stories 57, 58, 59, 60.

#### Phase 4 - Scale & international

Phase 4 is scoped as four isolated components. Detailed designs are deferred until Phase 3 exits, but the component boundaries and story coverage are fixed now so that nothing from `docs/user_stories.md` is orphaned.

**C20. Performance & database optimisation.** System performance monitoring and Postgres tuning (indexes, partitioning, read replicas as needed). Covers stories 61, 62.

**C21. Advanced security.** Automated security audit tooling and fraud detection pipeline. Covers stories 63, 64.

**C22. Marketplace expansion.** Additional specialised service offerings, group care arrangements, and a care-equipment marketplace. Covers stories 65, 66, 67.

**C23. Internationalisation.** Multi-currency, multi-language (next-intl), and region-specific compliance adaptations. Covers stories 68, 69, 70.

#### User story coverage matrix

Every numbered story in `docs/user_stories.md` maps to exactly one owning component (shown first). Where a story is also touched by a second component in a supporting role, that component is listed in parentheses. If a new story is added to `docs/user_stories.md`, a row must be added here and at least one component must claim it.

| Story | Title | Owner | Also touched by |
|---|---|---|---|
| 1 | System Admin seeded super user | C2 | - |
| 2 | Admin creates additional admins | C2 | - |
| 3 | Care Provider Company Registration | C3b | - |
| 4 | Care Provider Company Documentation Upload | C3b | (C5 verification, W1 live checks) |
| 5 | Individual Care Provider Registration | C3a | - |
| 6 | Individual Care Provider Documentation Upload | C3a | (C5 verification, W1 live DBS) |
| 7 | Provider Association with Company | C3b | - |
| 8 | Care Receiver Public Access | C2 | (C7a public directory) |
| 9 | Care Receiver Account Creation | C2 | (C9a self-serve) |
| 10 | Family Member Account Creation | C4 | - |
| 11 | Family Member Authorisation Upload | C4 | (C5 verification) |
| 12 | Add Additional Family Members | C4 | - |
| 13 | Care Provider Profile Creation | C6a | - |
| 14 | Care Provider Company Profile Creation | C6b | - |
| 15 | Care Receiver Needs Profile | C6b | (C17 smart matching) |
| 16 | Admin Verification of Providers | C5 | - |
| 17 | Admin Verification of Receiver/Family Authorisation | C5 | - |
| 18 | Basic Provider Search | C7a | - |
| 19 | Advanced Provider Filtering | C7b | - |
| 20 | Provider Profile Viewing | C7a | (C6a data) |
| 21 | Initial Contact Request | C8 | - |
| 22 | Provider Response to Contact | C8 | - |
| 23 | Schedule Initial Meeting | C8 | - |
| 24 | Stripe Integration for Payments | C13 | - |
| 25 | GoCardless Integration for Direct Debits | C14 | - |
| 26 | Care Plan Creation | C10 | - |
| 27 | Care Plan Review and Approval | C10 | - |
| 28 | Care Plan Pricing Transparency | C10 | (C13 invoicing) |
| 29 | Care Plan Revision | C10 | - |
| 30 | Care Plan Version History | C10 | - |
| 31 | Schedule Care Visits | C11 | (C10 source) |
| 32 | GPS Check-in for Visits | C11 | - |
| 33 | Visit Documentation | C11 | - |
| 34 | Visit Verification | C11 | - |
| 35 | Secure Messaging System | C9 | - |
| 36 | Document Sharing | C9 | - |
| 37 | Care Updates for Family Members | C9 | (C15 push) |
| 38 | Emergency Contact Alerting | C9 | (C15 push) |
| 39 | Medication Schedule Creation | C12 | - |
| 40 | Medication Administration Recording | C12 | - |
| 41 | Medication Update Notifications | C12 | (C9, C15) |
| 42 | Invoice Generation | C13 | - |
| 43 | Payment Processing | C13 | - |
| 44 | Payment History and Receipts | C13 | - |
| 45 | Platform Commission Calculation | C13 | - |
| 46 | Provider Mobile App | C15 | (delivered as PWA, not Flutter) |
| 47 | Receiver Mobile App | C15 | (delivered as PWA, not Flutter) |
| 48 | Push Notifications | C15 | - |
| 49 | Provider Rating System | C16 | - |
| 50 | Issue/Concern Reporting | C16 | - |
| 51 | Quality Improvement Suggestions | C16 | - |
| 52 | Smart Provider Matching | C17 | (C6, C15 needs profile) |
| 53 | Availability Matching | C17 | - |
| 54 | Provider Performance Analytics | C18 | - |
| 55 | Care Outcome Tracking | C18 | - |
| 56 | System Admin Reporting Dashboard | C18 | - |
| 57 | Calendar Integration | C19 | - |
| 58 | Export and Import Capabilities | C19 | - |
| 59 | Export and Import Capabilities (cont.) | C19 | - |
| 60 | API Access for Partners | C19 | - |
| 61 | System Performance Monitoring | C20 | - |
| 62 | Database Optimisation | C20 | - |
| 63 | Security Audit System | C21 | - |
| 64 | Advanced Fraud Detection | C21 | - |
| 65 | Additional Service Offerings | C22 | - |
| 66 | Group Care Arrangements | C22 | - |
| 67 | Care Equipment Marketplace | C22 | - |
| 68 | Multi-Currency Support | C23 | - |
| 69 | Multi-Language Support | C23 | - |
| 70 | Regional Compliance Adaptations | C23 | - |
| 71 | Live DBS re-verification | C3b | (W1) |
| 72 | Insurance verification API with expiry alerts | C3b | (W1) |
| 73 | Self-serve DSAR export | C24 | (W2 audit) |
| 74 | Right to erasure | C24 | (W2 audit, C5 admin triage) |
| 75 | WCAG 2.1 AA accessibility conformance | cross-cutting (all components) | (W3 axe-core enforcement) |
| 76 | Safeguarding report submission | C25 | (W1, W2) |
| 77 | Safeguarding triage and escalation | C25 | (W1, W2, C5 admin surface) |
| 78 | Visit media consent | C10 | (C11 enforcement) |
| 79 | Visit media retention caps | C11 | (W1 retention schedule) |
| 80 | Dispute submission | C26 | (C13 refunds, C25 escalation) |
| 81 | Dispute adjudication | C26 | (C5, C18 SLA metrics) |
| 82 | Abuse protection on public surfaces | C8 | (C7a directory, C9 messaging, storage abuse controls) |

### Success Metrics

- User growth (providers and receivers)
- Transaction volume
- Care plan creation and completion rates
- User satisfaction and feedback
- Platform uptime and performance
- Revenue growth
- CQC compliance metrics

### Risks & Mitigation

**Regulatory Risks:**

- Healthcare regulation changes
- Data protection requirements
- Mitigation: Regular compliance audits, legal consultation

**Market Risks:**

- Competitive pressure
- User adoption challenges
- Mitigation: Unique value proposition, marketing strategy

**Technical Risks:**

- Security vulnerabilities
- System reliability issues
- Mitigation: Regular security audits, robust testing strategy, RLS-first data access, mandatory pgTAP policy tests per W3
- **iOS PWA geolocation and push limitations:** iOS Safari restricts reliable background geolocation and requires a home-screen install for Web Push. This puts C11 (visit GPS check-in) and C15 (push notifications) at risk. Mitigation: foreground-only check-in UX in C11 by default; if field testing shows this is insufficient, wrap the existing Next.js surfaces in a thin Capacitor or Expo shell that exposes native geolocation and push, without rewriting UI code.
- **Supabase as a single point of failure (patient-safety framing).** The platform runs its database, auth, storage, and realtime on a single managed provider. A Supabase outage during a live visit window is not a UX inconvenience; a missed check-in that should have triggered an emergency alert (story 38) is a patient-safety incident. Mitigation is layered: (1) commit to explicit RPO and RTO targets and the Supabase tier required to meet them, with point-in-time recovery enabled; (2) subscribe to Supabase status and page on-call on platform outage, not just application errors; (3) the PWA in C15 maintains a **local outbound queue** of visit check-ins, check-outs, visit notes, and safeguarding reports, which are replayed against Supabase as soon as connectivity is restored, so a provider in the field can continue a visit and the record catches up afterwards; (4) the degraded-mode banner in the PWA shell tells the provider the system is offline so they do not mistake a silent failure for success; (5) long-term, evaluate a read-replica or cross-region standby once scale justifies the cost.

**Operational Risks:**

- Provider quality assurance
- Payment disputes
- Mitigation: Verification processes, dispute resolution procedures

### Timeline & Milestones

Detailed timeline to be developed with the technical team, with key milestones including:

- Requirements finalisation and PID signoff
- Design approval
- **Phase 1a MVP**: minimum viable discovery loop (C1, C2, C3a, C6a, C7a, C8, C9a). First external checkpoint and first production Rolling Release.
- Cross-cutting workstreams W1 (Regulatory & Trust), W2 (audit logging anchor in C2), and W3 (delivery practices) established before Phase 1b exit
- **Phase 1b Launch-ready**: companies, family circles, admin verification, DSAR/erasure, safeguarding escalation (C3b, C4, C5, C6b, C7b, C24, C25)
- Accessibility conformance sign-off (WCAG 2.1 AA) gated on Phase 1b exit; manual screen-reader walkthrough on VoiceOver and NVDA plus axe-core clean in Playwright
- Closed beta (end of Phase 1b)
- Payments and dispute resolution go-live (end of Phase 2, C13 + C14 + C26)
- PWA installability and push notifications milestone (Phase 3)
- Full platform launch

### Stakeholders

- Product Owner
- Development Team
- UX/UI Designers
- QA Testers
- Legal/Compliance Team
- Marketing Team
- Customer Support Team

### Conclusion

MyCareProvider aims to transform the care provision ecosystem by creating a transparent, efficient, and user-friendly platform that benefits all stakeholders. By focusing on the complete lifecycle of care provision and ensuring security, quality, and ease of use, the platform has significant potential for market success and positive social impact. The Next.js + Supabase architecture, combined with a component-indexed phase plan, allows the platform to be built incrementally by isolated work streams while preserving a single coherent production deployment.
