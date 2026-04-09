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

## Accessibility

Every themed surface carries a persistent audience label for WCAG 1.4.1 (color is never the only signal). See `components/ui/audience-banner.tsx`.
