# usdatacenterwatch — design doc

A public, open-source map of US data centers with modeled community-impact data: power, water, land, public subsidies, and jobs. Not an infrastructure directory — a civic-transparency tool.

## Product framing

- **Audience:** journalists, residents researching local builds, policymakers, researchers. Not the infra/sales crowd.
- **Differentiator vs. existing DC maps:** subsidy data per facility with sources, modeled power/water draw with uncertainty, watershed and grid-region overlays (v2).
- **Tone:** civic, sourced, transparent. Every number has a footnote. Methodology is public. Repo is open.

## Scope

### v1 (launch, ~early June 2026)
- ~50 hand-curated hyperscale campuses with full impact data (power/water/land/subsidies/jobs/sources)
- OSM bulk import (`man_made=data_center`) as second-tier coverage, marked low-confidence
- Map page with scaled-circle / heatmap / hex-bin / 3D-extrusion / county-choropleth view modes
- Filters: operator, tenant type, status, MW range, cooling type, year, state
- ⌘K search (counties + facilities)
- Side panel on click; `/facility/[slug]` URL shows the map with that facility's panel pre-opened
- SSR HTML shell at every facility URL for SEO + Open Graph
- Methodology page, About page, GitHub README
- Correction CTA → opens prefilled GitHub Issue
- Dark mode default
- Cloudflare Web Analytics

### v2+
- News scraper coverage of all 50 states
- County-permit-portal scrapers (Loudoun, Prince William, Maricopa, Hillsboro, etc.)
- Subsidy data backfill expanding outward from top 50
- `/county/[slug]` and `/state/[slug]` aggregation pages
- Watershed (HUC) overlay shaded by water draw
- Grid-region (PJM/MISO/ERCOT/etc.) overlay shaded by load
- Compare-facilities mode
- Local-fiscal data (property taxes paid, % of county budget)
- Air-permit / diesel-backup data from EPA NEI
- Permit-timeline view
- User submissions form (with email + captcha + moderation)

### Not in scope (deliberately)
- User accounts / auth
- Comments / discussion
- Photos (sourcing rabbit hole; satellite imagery is the proxy if we want it later)
- Comprehensive colo coverage (~3000+ sites; v1 covers hyperscalers only)
- Real-time data
- API for third parties (the static dataset on R2 is the API)

## Data model

Two tables in Neon Postgres + PostGIS.

### `facilities` — facts + provenance
```
id              uuid pk
slug            text unique          # e.g. "meta-prineville-or"
name            text
operator        text                  # "Meta"
tenant_type     enum                  # hyperscaler | colo | crypto | enterprise
tenants         text[]                # known customers, e.g. ["AWS us-east-1"]
status          enum                  # operational | under_construction | announced | decommissioned
location        geography(Point,4326)
address         text
city, county, state, fips
acres           numeric
sqft            numeric
year_built      int
it_load_mw      numeric               # if known
total_mw        numeric               # if known
design_pue      numeric               # if known
cooling_type    enum                  # air | evap | liquid | hybrid
reported_wue    numeric               # L/kWh, if disclosed
power_sources   jsonb                 # {grid: 0.7, solar: 0.2, gas_onsite: 0.1}
water_source    enum                  # municipal | reclaimed | well | surface | unknown
construction_capex_usd  numeric       # announced
jobs_construction       int           # announced
jobs_permanent          int           # announced
subsidies               jsonb         # array of {program, year, value_usd, source_url}
sources         jsonb                 # array of {url, accessed_at, supports: ["mw","acres",…]}
confidence      enum                  # high | medium | low
last_verified   timestamptz
created_at, updated_at
```

### `facility_estimates` — versioned modeled outputs
```
id              uuid pk
facility_id     uuid fk
methodology_version  text
estimated_annual_gwh        numeric
estimated_annual_gwh_low    numeric
estimated_annual_gwh_high   numeric
estimated_annual_gallons    numeric
estimated_annual_gallons_low  numeric
estimated_annual_gallons_high numeric
inputs          jsonb        # {pue: 1.4, utilization: 0.6, climate_evap_factor: 0.92, source_of_pue: "operator_disclosed_2024"}
computed_at     timestamptz
```

Re-running the model writes new rows; old rows kept for audit.

## Modeling

Tiered methodology (Option B layered with Option C):

1. **If operator publishes per-region PUE/WUE for that location → use it.** Google, Meta, Microsoft, AWS publish in annual sustainability reports.
2. **Else, use tiered defaults** by operator type + cooling type + year built:
   - Hyperscaler PUE: 1.10–1.20 depending on year
   - Colo PUE: 1.40–1.55
   - Crypto: 1.05
   - Air-cooled WUE: ~0.1 L/kWh
   - Evap-cooled WUE: ~1.8 L/kWh, modified by climate
3. **Climate factor:** pull NOAA/PRISM normals at the facility location; evap losses scale with wet-bulb temp.
4. **Annual output:** `kWh = it_load_mw × utilization × pue × 8760`; `gallons = kWh × wue × climate_factor × L_to_gal`.
5. **Uncertainty range:** ±20% for high-confidence inputs, ±50% for low-confidence; propagate.

Show uncertainty in UI as ranges with a methodology-page link. Inputs are visible on every facility page (PUE used, cooling type, climate factor source).

## Architecture

### Stack
- **Frontend:** Astro + React islands + TypeScript + Tailwind + shadcn/ui
- **Map:** MapLibre GL JS + deck.gl
- **Tiles:** Protomaps PMTiles (US extract) in Cloudflare R2, served by a Worker
- **Database:** Neon Postgres + PostGIS (used only by ingest pipeline + admin scripts)
- **Hosting:** Cloudflare Pages
- **Analytics:** Cloudflare Web Analytics

### Read path (the public website)
```
User → CF edge cache → static HTML (Astro SSG) + facilities-{hash}.json.gz from R2 + PMTiles from R2
```
**No DB query on the read path.** 99.9% of visits are pure CDN reads. Site stays up if Neon is down.

### Write path (corrections, future submissions)
```
User → CF Worker (rate-limited) → Neon submissions table → email/notify → manual review → PR to repo
```

### Data pipeline
1. **Source of truth: YAML files in the Git repo**, organized by state (e.g. `data/facilities/va/meta-ashburn-2.yaml`). Each file has the schema above.
2. **Scrapers run in GitHub Actions on cron.** One per source: news monitors per state, OSM Overpass query, county permit portals, Good Jobs First, etc. Output candidate updates to a `staging/` directory and open a PR.
3. **News extraction uses an LLM** (Claude / OpenRouter / Perplexity — pick best cost/perf at the time) to parse press releases into structured candidate facility records. Hallucination risk is bounded by mandatory human review.
4. **PR review is the moderation queue.** Maintainer reviews diffs, approves into `main`.
5. **On merge to `main`, an Action runs ingest:** parse YAML → validate → write to Neon → re-run estimates → export `facilities-{hash}.json.gz` and `facilities-{hash}.pmtiles` to R2 → invalidate stale cache key.
6. **Admin UI is deferred.** Markdown/YAML + GitHub PRs is the admin UI for v1.

## UX

### Map page
- Default view: scaled circles, sized by MW
- View-mode toggle (top-right): heatmap / hex bin / 3D extrusion / county choropleth
- Filter sidebar (left, collapsible): operator, tenant type, status, MW range, cooling type, year, state
- ⌘K command palette: counties + facilities + states
- Hover: floating card with name, operator, MW, est. GWh/yr, est. M gallons/yr, confidence badge
- Click: side panel slides in with full facility detail; URL updates to `/facility/[slug]`
- Persistent URL state for filters and viewport (shareable views)
- Smooth fly-to animations
- Dark mode default
- Mobile: bottom-sheet replaces side panel

### Facility detail (side panel + SSR HTML at /facility/[slug])
1. Hero: name, operator, status pill, address, big-numbers row (MW / GWh / M gal / acres) with `?` tooltips, confidence badge
2. Embedded map snippet (~500m radius, satellite toggle)
3. At-a-glance: tenants, power source mix, water source, cooling type, year built
4. **Community impact** (the differentiator):
   - Subsidies received — table with program/year/value/source link, total
   - Construction investment — announced capex
   - Jobs — construction vs. permanent, with realized-vs-announced footnote
   - Land — acres, prior land use if known
5. Methodology + sources — every number has a footnote with source URL and date verified
6. "Suggest a correction" → opens prefilled GitHub Issue
7. Related: other facilities by operator / in county

## Bootstrapping plan (4 weeks to launch)

**Week 1 — repo and stack**
- Astro app skeleton, Cloudflare Pages deploy
- MapLibre + deck.gl set up with 3-5 hardcoded test facilities
- Neon + PostGIS provisioned, basic schema
- YAML-to-Postgres ingest script
- GH Actions: ingest on merge to `main`, R2 export

**Week 2 — first 50 facilities**
- Hand-curate top 50 hyperscale campuses (Meta, Google, MSFT, AWS, Oracle) with public press-release sources
- Run model on all 50; verify outputs are plausible
- OSM Overpass import as second tier, marked low-confidence
- Methodology page, About page, README

**Week 3 — community impact data**
- Backfill subsidies on top 50 from Good Jobs First + JLARC + state economic-development reports
- Backfill construction capex + jobs from press releases
- Build news-monitor scraper for one state (start with VA — densest, most newsworthy)
- LLM extraction working; outputs PRs

**Week 4 — polish + launch**
- Filters + ⌘K search
- View-mode toggles (heatmap / hex / 3D / choropleth)
- Side-panel + facility URL routing
- SSR HTML for facility pages with Open Graph tags
- Correction CTA → GitHub Issue
- Public launch

## Licensing

- **Code:** MIT
- **Data:** CC BY-SA 4.0 (compatible with OSM derivation requirements)
- **Repo:** GitHub, personal account today, transfer to `usdatacenterwatch` org if collaborators show up

## Risks and mitigations

- **Bad/stale data damages credibility.** Mitigation: confidence scores, source URLs on every datapoint, public correction process, methodology page.
- **Subsidy data is hand-curated and slow to gather.** Mitigation: ship v1 with partial coverage (top 50 only), expand outward over time, mark facilities without subsidy data as "no subsidy data yet" rather than "no subsidies."
- **Goes viral, hits cost ceiling.** Mitigation: static-files-from-R2 read path means traffic is bounded by CF egress (free) and R2 storage (~$5/mo).
- **Operator pushback / legal threats.** Mitigation: every claim sourced; modeled estimates clearly labeled as such; no PII; takedown contact in About page.
- **Project never launches because scrapers keep getting better.** Mitigation: deadline (early June 2026), launch with 50 hand-curated + OSM, scrapers expand coverage *after* launch.
