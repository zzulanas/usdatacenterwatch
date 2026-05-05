# CLAUDE.md — usdatacenterwatch

Onboarding in 60 seconds.

## Stack

Astro 6 + React 19 (islands) + TypeScript strict + Tailwind v4 + shadcn/ui (new-york, neutral). Cloudflare Pages. pnpm.

## Key commands

```bash
pnpm dev        # dev server at http://localhost:4321
pnpm build      # static output → dist/
pnpm check      # typecheck + lint + unit tests + e2e — must pass before PR
pnpm test       # vitest unit tests only
pnpm e2e        # Playwright E2E tests against pnpm dev (port 4321)
pnpm format     # prettier -w .
```

## Static read-path invariant (non-negotiable)

**No DB query on any public read path.** The website reads static JSON from Cloudflare R2 (`facilities-{hash}.json.gz`). Neon/PostGIS is used ONLY in `scripts/` (ingest, model runner). If you find yourself importing a DB client from a page or React island, stop.

## Where data lives

- **Source of truth:** `data/facilities/{state}/{slug}.yaml` — one file per facility, hand-curated
- **Derived:** Neon DB (populated by ingest script from YAML) → `facilities-{hash}.json.gz` in R2
- **Public assets:** `public/` — static files served as-is

## Source conventions

- `src/pages/` — Astro pages (route = file path)
- `src/components/` — shared Astro + React components (key: `MapView.tsx` — MapLibre + deck.gl island, `client:only="react"`)
- `src/components/ui/` — shadcn/ui primitives (Button, etc.)
- `src/data/facilities.ts` — hardcoded seed facilities (USD-10; superseded by R2 pipeline in USD-11)
- `src/lib/cn.ts` — Tailwind class merge helper (tested in `cn.test.ts`)
- `src/styles/global.css` — Tailwind v4 `@import "tailwindcss"` + CSS variables
- `scripts/` — ingest pipeline, DB migrations (never imported by pages)
- `@/` path alias → `src/`

## Agents

- `.claude/agents/staff-engineer.md` — architecture decisions, ticket planning, design review
- `.claude/agents/cracked-engineer.md` — feature implementation, bug fixes, data pipeline (you are here)
- `.claude/agents/design-engineer.md` — visual design, component polish, typography decisions

## Branch discipline

Never push to `main` directly. Branch `feat/usd-NN-slug` → PR → review → merge. Run `pnpm check && pnpm build` before pushing.
