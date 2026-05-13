# Data Pipeline

How facility data flows from hand-curated YAML files into the Neon database and eventually into the public-facing static dataset.

## Overview

```
data/facilities/{state}/{slug}.yaml   (source of truth — human-curated)
          │
          ▼
  pnpm ingest  (validate → upsert → compute estimates)
          │
          ▼
   Neon Postgres + PostGIS
          │
          ▼
  pnpm export  (USD-9 — DB → R2 facilities-{hash}.json.gz)
          │
          ▼
Cloudflare R2  →  public website (static read path)
```

The website **never** queries Neon directly. All reads are from the pre-exported JSON.

---

## Adding a New Facility

1. **Create the YAML file.**
   Path: `data/facilities/{state-abbr-lowercase}/{slug}.yaml`
   Example: `data/facilities/va/google-loudoun-va.yaml`

2. **Fill in the required fields.** At minimum:
   - `slug` — globally unique, lowercase kebab-case, include state abbreviation
   - `name`, `operator`, `tenant_type`, `status`
   - `location: { lng, lat }` — decimal degrees WGS84
   - `confidence` — `high | medium | low`
   - `sources` — at least one entry with `url`, `accessed_at`, `supports`

3. **Add sources for every datapoint.** Each numeric or key claim must appear in
   at least one `sources[].supports` entry. No numbers without footnotes.

4. **Run the ingest locally to validate.**

   ```bash
   DATABASE_URL="$YOUR_TEST_URL" pnpm ingest
   ```

   Fix any Zod validation errors (unknown fields, wrong types, missing sources, etc.)

5. **Open a PR.** CI runs the ingest on merge to `main`.

---

## YAML Schema Reference

Full schema defined in `src/lib/zod-facility-schema.ts`. Key rules:

| Field                    | Required | Notes                                                              |
| ------------------------ | -------- | ------------------------------------------------------------------ |
| `slug`                   | yes      | Lowercase kebab-case; must include state abbreviation              |
| `name`                   | yes      | Official campus name                                               |
| `operator`               | yes      | Company that operates the facility                                 |
| `tenant_type`            | yes      | `hyperscaler \| colo \| crypto \| enterprise`                      |
| `status`                 | yes      | `operational \| under_construction \| announced \| decommissioned` |
| `location.lng`           | yes      | Decimal degrees, −180 to 180                                       |
| `location.lat`           | yes      | Decimal degrees, −90 to 90                                         |
| `confidence`             | yes      | `high \| medium \| low`                                            |
| `sources`                | yes      | Array, min length 1                                                |
| `power_sources`          | no       | If present, values must sum to ≈ 1.0 (±0.01)                       |
| `it_load_mw`             | no       | Required for estimates; leave null if unknown                      |
| All other numeric fields | no       | Nullable; use `null` if unknown                                    |

The schema uses `.strict()` — unknown keys are rejected to catch typos early.

---

## Running the Ingest

```bash
# Use the main Neon branch
pnpm ingest

# Override DATABASE_URL for a dev branch
DATABASE_URL="postgres://..." pnpm ingest
```

**Idempotency:**

- `facilities` table: `ON CONFLICT (slug) DO UPDATE` — safe to run multiple times; last write wins on all mutable fields.
- `facility_estimates` table: always `INSERT` (append-only) — running the ingest twice produces two estimate rows per facility, preserving the audit trail.

**Exit codes:**

- `0` — success
- `1` — validation error(s) or DB error; check stderr for details

---

## Estimates Methodology

Version: `2026-05-v1` (stored in `facility_estimates.methodology_version`)

### Energy

```
kWh/yr = it_load_mw × 1000 × utilization × PUE × 8760
GWh/yr = kWh/yr ÷ 1,000,000
```

### Water

```
gal/yr = kWh/yr × WUE × climate_factor × 0.264172
```

### Constants (v1)

| Parameter                 | Value      | Source                                      |
| ------------------------- | ---------- | ------------------------------------------- |
| Utilization               | 0.60       | Industry consensus for hyperscale           |
| PUE (hyperscaler default) | 1.15       | Mid-range of 1.10–1.20                      |
| PUE (colo default)        | 1.45       | Uptime Institute survey                     |
| PUE (crypto default)      | 1.05       | Highly optimized, near-minimum              |
| PUE (enterprise default)  | 1.55       | Older stock, less efficient                 |
| WUE air-cooled            | 0.10 L/kWh | Minimal cooling water                       |
| WUE evap-cooled           | 1.80 L/kWh | ASHRAE baseline                             |
| WUE liquid-cooled         | 0.20 L/kWh | Closed-loop efficiency                      |
| WUE hybrid                | 1.00 L/kWh | Blend of air + evap                         |
| Climate factor            | 1.0        | v1 default; NOAA/PRISM integration deferred |
| L/kWh → gal               | 0.264172   | Unit conversion                             |

### Uncertainty Bands

| Confidence        | Band                     |
| ----------------- | ------------------------ |
| `high`            | ±20% of central estimate |
| `medium` or `low` | ±50% of central estimate |

### Methodology Versioning

When constants or formulas change, bump the version string in
`scripts/ingest/estimates.ts`:

```typescript
export const METHODOLOGY_VERSION = '2026-05-v1';
```

Old estimate rows are never updated — re-running the ingest appends a new row
with the new version. This lets us track how estimates change as the methodology
improves and compare old vs. new outputs for any facility.

### Known Limitations (v1)

1. **Climate factor is fixed at 1.0.** Real evaporative WUE depends on local
   wet-bulb temperature. TODO: Integrate NOAA/PRISM 30-year normals for each
   facility lat/lng to derive a per-location multiplier. High wet-bulb climates
   (Phoenix) will need ~1.3×; mild climates (Pacific Northwest) ~0.7×.

2. **Utilization is a single default.** Some facilities run higher (hyperscalers
   near capacity) or lower (enterprise with headroom). Per-facility utilization
   disclosures can override the default when available.

3. **PUE defaults are annual averages.** Actual PUE varies seasonally. For the
   highest-confidence facilities, published quarterly PUE data could be used
   for a monthly model.

---

## File Locations

| Path                             | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `data/facilities/`               | YAML source of truth (one file per facility) |
| `src/lib/zod-facility-schema.ts` | Zod schema for YAML validation               |
| `scripts/ingest.ts`              | Entry point                                  |
| `scripts/ingest/yaml-loader.ts`  | YAML file discovery and parsing              |
| `scripts/ingest/validate.ts`     | Zod validation with error collection         |
| `scripts/ingest/upsert.ts`       | Neon upsert (facilities + estimates)         |
| `scripts/ingest/estimates.ts`    | Tiered power/water modeling                  |
| `scripts/ingest.test.ts`         | Unit tests                                   |
