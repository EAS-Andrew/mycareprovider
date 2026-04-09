# MyCareProvider

Dual-sided UK care marketplace connecting care receivers and families with vetted care providers. See `docs/pid.md` for the full project initiation document and `docs/brand/COLORS.md` for the brand rules.

## Status

Phase 1a, component C1 (platform shell and design system). No auth, no database yet.

## Running locally

```bash
nvm use         # Node 24
npm install
npm run dev
```

Routes to try:

- `/` - public landing (unified mark)
- `/receiver` - blue theme, "Care receiver" banner
- `/provider` - purple theme, "Care provider" banner
- `/admin` - neutral slate theme, "Administrator" banner

## Theme isolation rule

Blue and purple never mix on a logged-in screen. Shared UI components in `components/ui/` must read `--brand-*` CSS variables, never hardcoded blue or purple values. Each route group layout (`app/(receiver)`, `app/(provider)`, `app/(admin)`) sets its own theme via `data-theme`. Do not import from one group inside another.

Run `npm run check:themes` to verify no cross-group imports exist.

## Local setup (Supabase)

Copy `.env.example` to `.env.local` and fill in the keys from your Supabase project (local stack or hosted). The app reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

The `app_role` JWT claim is populated by a Supabase Auth Hook. Locally, `supabase/config.toml` already wires `public.custom_access_token_hook` so `supabase start` picks it up. In hosted environments, enable it under Dashboard -> Authentication -> Hooks -> Custom Access Token and point it at the same function.

## Deployment

Hosted on Vercel as `ctrl-alt-elite-uk/mycareprovider`. Pushes to `main` deploy to production; other branches get preview URLs automatically.

## Accessibility

Every themed surface carries a persistent audience label for WCAG 1.4.1 (color is never the only signal). See `components/ui/audience-banner.tsx`.
