# CLAUDE.md — usdatacenterwatch

Onboarding in 60 seconds.

## Stack

Astro 6 + React 19 (islands) + TypeScript strict + Tailwind v4 + shadcn/ui (new-york, neutral). Cloudflare Pages. pnpm.

## Key commands

```bash
pnpm dev        # dev server at http://localhost:4321
pnpm build      # static output → dist/client/ (Cloudflare adapter splits client + server)
pnpm check      # typecheck + lint + unit tests + e2e — must pass before PR
pnpm test       # vitest unit tests only
pnpm e2e        # Playwright E2E tests against pnpm dev (port 4321)
pnpm format     # prettier -w .

# Deployment
# Pages deploy targets dist/client/ — the adapter puts static HTML/assets there.
# Deploy via wrangler: npx wrangler pages deploy dist/client --project-name=usdatacenterwatch
# Production URL: https://usdatacenterwatch.pages.dev

# Database (server-only — never run from browser context)
pnpm db:generate  # generate migration SQL from schema diff (after editing src/db/schema.ts)
pnpm db:migrate   # apply pending migrations to DATABASE_URL (reads from env)
pnpm db:studio    # open Drizzle Studio UI for the connected database
pnpm db:push      # push schema directly to DB — prototyping only, never in CI
pnpm ingest       # YAML → Postgres ingest: validate + upsert facilities + compute estimates
pnpm export-r2    # Neon → R2: export facilities-{hash}.json.gz + manifest.json
pnpm validate-model           # calibrate estimates model against operator disclosures
pnpm validate-model --strict  # exit non-zero on drift (used by CI)

# OSM bulk import (no DB or env required — writes YAML files directly)
pnpm osm-import --state VA           # import one state (pilot: Virginia is OSM-dense)
pnpm osm-import --state VA --dry-run # print what would be written, no file changes
pnpm osm-import --all                # all CONUS states (run pilot state first)
# Output goes to data/facilities/{state-lower}/{slug}.yaml, all marked confidence: low.
# After import: run pnpm test to verify Zod validation, then pnpm ingest to push to DB.
```

## Static read-path invariant (non-negotiable)

**No DB query on any public read path.** The website reads static JSON from Cloudflare R2 (`facilities-{hash}.json.gz`). Neon/PostGIS is used ONLY in `scripts/` (ingest, model runner). If you find yourself importing a DB client from a page or React island, stop.

## Where data lives

- **Source of truth:** `data/facilities/{state}/{slug}.yaml` — one file per facility, hand-curated
- **Derived:** Neon DB (populated by ingest script from YAML) → `facilities-{hash}.json.gz` in R2
- **Public assets:** `public/` — static files served as-is

## Basemap

Carto Dark Matter (free, attribution required). State + county lines + roads
visible at appropriate zooms; dark theme matches our civic/journalistic aesthetic.
Self-hosted PMTiles on R2 is the M2 upgrade — see Linear ticket USD-9.

## Source conventions

- `src/pages/` — Astro pages (route = file path)
- `src/components/` — shared Astro + React components (key: `MapView.tsx` — MapLibre + deck.gl island, `client:only="react"`)
- `src/components/ui/` — shadcn/ui primitives (Button, etc.)
- `src/data/facilities.ts` — hardcoded seed facilities (build-time fallback when PUBLIC_R2_BASE_URL not set)
- `src/lib/load-facilities.ts` — runtime R2 loader: fetches manifest → dataset; falls back to seed data
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

## CI gates (every PR to main)

`.github/workflows/ci.yml` runs on every PR and push to `main`:

1. `pnpm typecheck` — Astro + TS check
2. `pnpm lint` — ESLint
3. `pnpm test` — Vitest unit tests
4. `pnpm e2e` — Playwright E2E against `pnpm dev` (Chromium only)
5. `pnpm build` — full Astro build

All five must pass. On failure, the Playwright HTML report is uploaded as a CI artifact.

`.github/workflows/deploy.yml` deploys to Cloudflare Pages on every push to `main` and creates PR preview deployments on every PR.
