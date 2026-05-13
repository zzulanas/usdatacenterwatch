# US Data Center Watch

[![CI](https://github.com/zzulanas/usdatacenterwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/zzulanas/usdatacenterwatch/actions/workflows/ci.yml)
[![Deploy](https://github.com/zzulanas/usdatacenterwatch/actions/workflows/deploy.yml/badge.svg)](https://github.com/zzulanas/usdatacenterwatch/actions/workflows/deploy.yml)

A public, open-source civic-transparency tool mapping US data centers with modeled community-impact data: power draw, water consumption, land use, public subsidies, and jobs — per facility, with sources. Built for journalists, residents researching local builds, and policymakers who need a single sourced view of hyperscale infrastructure and its costs to communities.

- **Design doc:** [`DESIGN.md`](./DESIGN.md)
- **Linear project:** https://linear.app/usdatacenterwatch/project/usdatacenterwatch-v1-launch-a8f6481650a0
- **License:** MIT (code), CC BY-SA 4.0 (data)

**Live site:** https://usdatacenterwatch.pages.dev

## Quick start

```bash
pnpm install
pnpm dev         # dev server at http://localhost:4321
pnpm build       # static output → dist/client/
pnpm check       # typecheck + lint + unit tests + e2e — must pass before PR
```

## Stack

Astro 6 + React 19 islands, TypeScript strict, Tailwind CSS v4, shadcn/ui (new-york style, neutral). Hosted on Cloudflare Pages. No DB on the read path — public pages read `facilities-{hash}.json.gz` from Cloudflare R2.

See [DESIGN.md](./DESIGN.md) for full architecture.
