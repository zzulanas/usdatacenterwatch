# Facility curation guide

This directory holds the curated YAML source-of-truth for every facility on
usdatacenterwatch. Each file is one campus (a "facility" in our schema). The
canonical example is `or/meta-prineville.yaml`. Read that one first.

## Layout

```
data/facilities/
  {state-lower}/{slug}.yaml
```

`{state-lower}` is the two-letter postal code (`or`, `nc`, `ia`, …). `{slug}`
is `{operator}-{city}-{state}` lowercase, kebab-cased, e.g.
`meta-eagle-mountain-ut`. Multi-word cities are hyphenated (`forest-city`,
`the-dalles`, `council-bluffs`).

## Schema

The canonical Zod schema lives at `src/lib/zod-facility-schema.ts` and is the
only authority on what fields are allowed. The ingest pipeline (`pnpm ingest`)
runs this schema with `.strict()`, so unknown keys are an error — not a typo
hint. If validation fails, fix the file rather than adding the key to the
schema unless you actually intend to extend the data model.

Required fields: `slug`, `name`, `operator`, `tenant_type`, `status`,
`location`, `confidence`, `sources` (≥1).

Optional fields cover: location detail (`address`, `city`, `county`, `state`,
`fips`), physical (`acres`, `sqft`, `year_built`), power (`it_load_mw`,
`total_mw`, `design_pue`, `cooling_type`, `reported_wue`, `power_sources`),
water (`water_source`), economic (`construction_capex_usd`, `jobs_*`,
`subsidies`), provenance (`last_verified`).

## Sourcing rules (non-negotiable)

1. **Every numeric or assertable field must trace to a `supports[]` entry on
   a `sources[]` URL.** If no URL in `sources` backs the field, the field
   should not appear in the file. Census-derivable fields (`state`, `county`,
   `fips`, `city` for well-known places) are the only exception.

2. **Sources hierarchy, strongest first:**
   - **Primary**: operator-published material (Meta sustainability report,
     datacenters.google location pages, Apple SEC filings), municipal/county
     records (city council resolutions, EDC press releases, parcel/GIS),
     federal filings (SEC, FERC), state regulatory filings.
   - **Secondary**: trade journalism with named-source reporting (Data Center
     Frontier, Data Center Dynamics, Data Center Knowledge), local press
     (Hickory Record, Oregon Public Broadcasting, etc.).
   - **Tertiary**: aggregators (baxtel, datacentermap, datacenters.com,
     dgtlinfra). These are useful for the `location` lat/lng pin and as
     cross-check on basic facts, but should not be the _sole_ source for a
     numeric claim.

3. **Omitted-field comment block.** Every YAML must end the data block with
   a `# Fields intentionally omitted because no public source asserts the value:`
   comment listing the fields we looked for and could not source, with a
   one-line reason per field. This prevents future curators from re-doing
   the same dead-end research. Example: `or/meta-prineville.yaml`.

4. **`confidence` is per-facility, not per-field.** Set `high` when IT load
   plus identity (name, operator, location, year) are all primary-sourced.
   Set `medium` when IT load is not disclosed but the rest is solid. `low`
   is for facilities where the location itself is industry-estimated. We
   default to `medium` for hyperscaler campuses where operators don't
   publish per-site IT load.

5. **`last_verified`** is the date you checked the sources yourself. Bump
   when you re-verify. Stale dates flag facilities that need a refresh.

## `supports[]` conventions

The `supports[]` array on each source entry names which fields that URL
_directly_ backs. Be precise — listing every field name is not the goal.

- `name`, `operator`, `city`, `state`: assertable from any source that
  uses the facility name in context.
- `address`: must come from a source that prints the street address. Do
  not assert `address` from an aggregator-only chain. County parcel records
  (`gis.<county>countync.org/maps`) or municipal records are the strongest.
- `location`: the lat/lng pin. Aggregators (baxtel, loopnet) are an
  acceptable source for `location` since most aggregator coordinates derive
  from geocoded addresses, but the underlying `address` should still trace
  to a primary source if the file asserts one.
- `it_load_mw`, `total_mw`: hyperscalers rarely publish per-site MW
  capacity directly. Acceptable sourcing paths, ordered by quality:
  1. **Primary direct**: a source that prints the MW figure (rare for
     hyperscalers; common for colos and crypto miners). Use with
     `confidence: high` on the facility if other identity fields are also
     primary-sourced.
  2. **Derived from operator-published annual MWh**: Meta's sustainability
     report and Apple's environmental responsibility report publish
     per-site annual electricity consumption. Back-calculate to MW with
     the modeling pipeline's defaults (`PUE × utilization × 8760 hr/yr`)
     and document the derivation in an inline comment above the
     `it_load_mw:` line. Confidence: medium (round-trips exactly through
     `estimates.ts` but assumes default PUE/utilization). Cite both the
     primary disclosure URL and any corroborating trade-press summary in
     the source's `supports: [it_load_mw]`.
  3. **Industry tracker / interconnection record** (interconnection.fyi,
     datacenter.fyi, datacentermap): these aggregate from FCC, FERC,
     utility tariffs, and permit reviews but rarely publish their
     methodology per-record. Acceptable as a SOLE source only for
     `total_mw` (nameplate / interconnection capacity), not `it_load_mw`.
     Confidence on the facility: medium; add an inline note explaining
     "Aggregator-cited, methodology not published — used as lower-bound
     for total_mw" so the next reviewer knows the basis.
  4. **DO NOT conflate**: backup-generator capacity, solar PPA size, or
     renewable-procurement contracts are NOT IT load. Many hyperscalers
     publish large renewable PPAs (Google's 407 MW MidAmerican deal for
     Council Bluffs, Apple's 60 MW Maiden solar arrays); these tell you
     nothing about the data center's actual load and must not back
     `it_load_mw`.
- `construction_capex_usd`: prefer a source that prints the dollar figure
  with context (single-build vs cumulative). When a figure is cumulative,
  add an inline `# Note on construction_capex_usd:` comment above the
  omission block clarifying the basis.
- `year_built`: prefer the year the first building was operational, not
  the year construction began.
- `fips`: the 5-digit county FIPS code. This is self-derivable from
  `state` + `county` via the Census Geocoder
  (`https://geocoding.geo.census.gov/`) — it does not need an entry in any
  `supports[]` array. Double-check it: a wrong `fips` silently miscategorizes
  the facility in any county-level UI filter.

## Workflow

```bash
# 1. Add or edit a YAML file under data/facilities/{state}/{slug}.yaml
# 2. Validate locally without touching the DB:
pnpm tsx -e "import {loadYamlFiles} from './scripts/ingest/yaml-loader.js'; \
  import {validateFacilities,reportFailures} from './scripts/ingest/validate.js'; \
  const f=loadYamlFiles('./data/facilities','.'); \
  const r=validateFacilities(f); reportFailures(r.failures); \
  console.log('valid:',r.valid.length,'failed:',r.failures.length)"

# 3. Run the existing test suite (no new tests needed for data-only PRs)
pnpm test && pnpm e2e

# 4. Branch + PR per Linear ticket — never push directly to main.
```

The CI pipeline runs `pnpm ingest` against Neon on every push to `main`,
then `pnpm export-r2` regenerates `facilities-{hash}.json.gz` and bumps the
manifest. The live map picks up the new dataset on the next page load.
