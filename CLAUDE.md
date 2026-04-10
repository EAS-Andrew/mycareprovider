# MyCareProvider - Project Instructions

## Project overview

MyCareProvider is a UK care marketplace connecting care receivers with care providers. Single Next.js 16 app (App Router) backed by Supabase, hosted on Vercel. Full spec lives in `docs/pid.md`; user stories in `docs/user_stories.md`.

## Tech stack

- **App**: Next.js 16 (Turbopack), React 19, TypeScript strict, Tailwind v4, shadcn-shaped components
- **Database**: Supabase Postgres with Row-Level Security on every table
- **Auth**: Supabase Auth, roles in `profiles` table, custom JWT claim via access token hook
- **Proxy**: `proxy.ts` (Next.js 16 convention) handles role gating
- **Hosting**: Vercel Fluid Compute

## Architecture rules

- Route groups are thematic boundaries: `(public)`, `(receiver)` (blue), `(provider)` (purple), `(admin)` (neutral slate). Cross-group component imports are banned.
- Shared UI in `components/ui/` reads CSS variables, never hardcoded brand colors.
- RLS helper functions live in the `app` schema (not `auth`). Policies are one-liners calling helpers. No polymorphic ownership. See PID "RLS-safety conventions" section.
- Every regulated table has `deleted_at` for soft-delete. Read policies include `AND deleted_at IS NULL`.
- Append-only tables (audit_log, care_plan_versions, etc.) have no UPDATE/DELETE policies.
- Role is always read via `lib/auth/current-role.ts:getCurrentRole()` which queries `profiles.role`. Never trust `user_metadata.role`.
- All mutations on regulated entities call `recordAuditEvent()` from `lib/audit/record-audit-event.ts`.
- Documents use the quarantine upload pattern: upload to `quarantine/<uid>/`, promote to `clean/` after scan.

## Key file locations

- `proxy.ts` - role gating middleware
- `lib/supabase/{server,client,admin,middleware}.ts` - Supabase client factories
- `lib/auth/current-role.ts` - canonical role reader
- `lib/audit/record-audit-event.ts` - W2 audit helper
- `supabase/migrations/` - ordered migrations (0001-0016+)
- `supabase/seed.sql` - synthetic dev seed data
- `supabase/tests/rls/` - pgTAP RLS policy tests
- `scripts/check-theme-isolation.mjs` - theme cross-import guard
- `docs/pid.md` - authoritative project spec with "What landed" per component
- `docs/user_stories.md` - acceptance criteria by story number

## Using agent teams

When using Claude Code agent teams for implementation work, follow these guidelines for consistency across sessions.

### Teammate structure: per-component, not per-layer

Organise teammates by **PID component** (C3b, C4, C5, etc.), not by technical layer (database, backend, frontend). Each component teammate owns the full vertical slice: migration, RLS, pgTAP tests, Server Actions, UI routes.

Why: components are defined to have minimal cross-dependencies. A per-layer split (one agent does all migrations, another does all UI) creates serialisation bottlenecks and merge conflicts. A per-component split lets teammates work in parallel on isolated worktrees with no file overlap.

### Wave planning

Group components into waves based on the dependency graph in the PID. Within a wave, all components can be built in parallel. Create one team per wave.

1. Read the PID to identify which components are ready (all dependencies shipped).
2. Create a team and tasks for the wave.
3. Spawn one teammate per component in an isolated worktree.
4. As teammates finish, shut them down. When the wave is complete, delete the team and create the next.

### Teammate prompts must include

Every teammate prompt should contain:
- Which component they're building and which user stories it covers
- Which existing files to read first (migrations, Server Actions, UI patterns)
- The security/RLS patterns to follow (reference this CLAUDE.md or specific migrations)
- **PID update instruction**: "As part of your deliverable, write a 'What landed' section for [component] in docs/pid.md, matching the format of existing shipped components."

### Keeping the PID current

The PID (`docs/pid.md`) is the single source of truth for what has been built. It must stay up to date:

- **Teammates write their own "What landed" entries** as part of their deliverable. This is more accurate than the team lead reconstructing it after the fact.
- The "What landed" entry should include: migration name and key tables/columns, RLS summary, Server Action list, UI routes added, pgTAP test count.
- Update the component's status line (add `**Status: shipped (date).**`).
- After each wave, the team lead should verify PID entries landed and fix any migration numbering conflicts.

### Migration numbering

Teammates in the same wave work in isolated worktrees and may pick the same migration number. After merging, the team lead must check for duplicates and renumber. Convention: migrations are numbered sequentially in commit order on main.

### What the team lead does between waves

1. Verify all worktree branches merged cleanly to main
2. Run `npm run build` to confirm the combined build passes
3. Check `supabase/migrations/` for numbering conflicts, renumber if needed
4. Verify PID "What landed" entries are present and accurate
5. Commit any fixups (renumbering, PID corrections)
6. Delete the team and create the next wave

## Migrations

Supabase migrations must be applied after implementation and before pushing to main.

### Local development

After a teammate or the team lead creates a new migration file in `supabase/migrations/`, run:

```bash
npx supabase db reset
```

This drops and recreates the local database, replaying all migrations in order. Verify the migration applies cleanly before committing.

### Remote (production/staging)

Before pushing to main (or as part of the push workflow), apply pending migrations to the linked Supabase project:

```bash
npx supabase db push
```

This runs any migrations not yet applied to the remote database. Never push code to main that references tables or columns from a migration that has not been applied remotely.

### Teammate responsibility

Each teammate working in an isolated worktree should run `npx supabase db reset` after writing their migration to confirm it applies cleanly alongside all prior migrations. The team lead runs `npx supabase db reset` again after merging all worktree branches to catch any numbering conflicts or incompatibilities.

## Writing style

- Never use emdashes. Use hyphens, commas, or rephrase instead.
