#!/usr/bin/env tsx
/**
 * osm-import.ts — Bulk-import US data centers from OpenStreetMap.
 *
 * Usage:
 *   pnpm osm-import --state VA           # import for one state
 *   pnpm osm-import --state VA --dry-run # print what would be written, no file changes
 *   pnpm osm-import --all                # all 50 states (run pilot first)
 *
 * Pipeline:
 *   1. Query Overpass API for way + relation elements tagged as data_center
 *   2. Filter: skip nodes, skip no name+operator, skip outside CONUS
 *   3. Normalize tags → FacilityYaml shape, confidence: low, cite OSM source
 *   4. Dedup against existing curated facilities (slug collision + 500m proximity)
 *   5. Write YAML stubs under data/facilities/{state}/{slug}.yaml
 *
 * All output is marked confidence: low. Curators upgrade to medium/high after
 * cross-checking with a secondary source (utility filings, county GIS, trade press).
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Types for raw OSM Overpass API response
// ---------------------------------------------------------------------------

export interface OsmElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  center?: { lat: number; lon: number };
  /** lat/lon on node elements directly */
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OsmElement[];
}

// ---------------------------------------------------------------------------
// State bounding boxes (CONUS 48 + DC; Alaska/Hawaii excluded)
// CONUS exclusion bbox: lat ∈ [22, 52], lng ∈ [-130, -65]
// Individual state bboxes improve Overpass query efficiency on --all runs.
// Format: [minLat, minLon, maxLat, maxLon]
// ---------------------------------------------------------------------------

export const STATE_BBOXES: Record<string, [number, number, number, number]> = {
  AL: [30.1, -88.5, 35.0, -84.9],
  AR: [33.0, -94.6, 36.5, -89.6],
  AZ: [31.3, -114.8, 37.0, -109.0],
  CA: [32.5, -124.4, 42.0, -114.1],
  CO: [37.0, -109.1, 41.0, -102.0],
  CT: [40.9, -73.7, 42.1, -71.8],
  DC: [38.8, -77.1, 39.0, -76.9],
  DE: [38.4, -75.8, 39.8, -75.0],
  FL: [24.4, -87.6, 31.1, -80.0],
  GA: [30.4, -85.6, 35.0, -80.8],
  IA: [40.4, -96.6, 43.5, -90.1],
  ID: [42.0, -117.2, 49.0, -111.0],
  IL: [36.9, -91.5, 42.5, -87.0],
  IN: [37.8, -88.1, 41.8, -84.8],
  KS: [37.0, -102.1, 40.0, -94.6],
  KY: [36.5, -89.6, 39.1, -81.9],
  LA: [28.9, -94.0, 33.0, -88.8],
  MA: [41.2, -73.5, 42.9, -69.9],
  MD: [37.9, -79.5, 39.7, -75.0],
  ME: [43.1, -71.1, 47.5, -66.9],
  MI: [41.7, -90.4, 48.2, -82.4],
  MN: [43.5, -97.2, 49.4, -89.5],
  MO: [36.0, -95.8, 40.6, -89.1],
  MS: [30.2, -91.7, 35.0, -88.1],
  MT: [44.4, -116.1, 49.0, -104.0],
  NC: [33.8, -84.3, 36.6, -75.5],
  ND: [45.9, -104.1, 49.0, -96.6],
  NE: [40.0, -104.1, 43.0, -95.3],
  NH: [42.7, -72.6, 45.3, -70.6],
  NJ: [38.9, -75.6, 41.4, -73.9],
  NM: [31.3, -109.1, 37.0, -103.0],
  NV: [35.0, -120.0, 42.0, -114.0],
  NY: [40.5, -79.8, 45.0, -71.9],
  OH: [38.4, -84.8, 42.3, -80.5],
  OK: [33.6, -103.0, 37.0, -94.4],
  OR: [42.0, -124.6, 46.3, -116.5],
  PA: [39.7, -80.5, 42.3, -74.7],
  RI: [41.1, -71.9, 42.0, -71.1],
  SC: [32.0, -83.4, 35.2, -78.5],
  SD: [42.5, -104.1, 45.9, -96.4],
  TN: [34.9, -90.3, 36.7, -81.6],
  TX: [25.8, -106.6, 36.5, -93.5],
  UT: [37.0, -114.0, 42.0, -109.0],
  VA: [36.5, -83.7, 39.5, -75.2],
  VT: [42.7, -73.4, 45.0, -71.5],
  WA: [45.5, -124.8, 49.0, -116.9],
  WI: [42.5, -92.9, 47.1, -86.2],
  WV: [37.2, -82.6, 40.6, -77.7],
  WY: [41.0, -111.1, 45.0, -104.0],
};

// CONUS bbox — the broad filter. Alaska and Hawaii excluded:
// - Alaska data centers exist but no hyperscalers; a future state-level run can include AK/HI
// - CONUS bbox used as a sanity check when per-state bbox isn't available
export const CONUS_BBOX: [number, number, number, number] = [22, -130, 52, -65];

// ---------------------------------------------------------------------------
// Operator alias normalization
// OSM mappers abbreviate freely; we canonicalize to the full legal name.
// Adding entries here is cheap — keep the list minimal and grow as pilot reveals edge cases.
// ---------------------------------------------------------------------------

export const OPERATOR_ALIASES: Record<string, string> = {
  AWS: 'Amazon Web Services',
  'Amazon.com': 'Amazon Web Services',
  Amazon: 'Amazon Web Services',
  MSFT: 'Microsoft',
  Microsoft: 'Microsoft',
  Google: 'Google',
  Alphabet: 'Google',
  Apple: 'Apple',
  Meta: 'Meta',
  Facebook: 'Meta',
  'Meta Platforms': 'Meta',
  IBM: 'IBM',
  Oracle: 'Oracle',
  Salesforce: 'Salesforce',
  // CenturyLink rebranded to Lumen Technologies in 2020; OSM still uses old name in some records
  Centurylink: 'Lumen Technologies',
  CenturyLink: 'Lumen Technologies',
  // CoreSite legal entity names map to canonical brand
  'CoreSite Real Estate 1656 McCarthy, L.P.': 'CoreSite',
  Coresite: 'CoreSite',
};

// Known hyperscaler operators (post-alias-normalization)
const HYPERSCALERS = new Set([
  'Amazon Web Services',
  'Google',
  'Microsoft',
  'Meta',
  'Apple',
  'Oracle',
  'IBM',
]);

// Known colo operators (post-alias-normalization)
const COLOS = new Set([
  'Equinix',
  'Digital Realty',
  'CyrusOne',
  'CoreSite',
  'Iron Mountain',
  'QTS',
  'Quality Technology Services',
  'NTT',
  'CloudHQ',
  'Vantage Data Centers',
  'Aligned',
  'DataBank',
  'Databank',
  'PowerHouse',
  'Stack Infrastructure',
  'Lumen Technologies',
  'Centersquare',
  'Cyxtera',
  'Switch',
  'T5',
  'Flexential',
  'DuPont Fabros Technology',
  'ClearDC',
  'Stream',
  'AiNET',
  'True North Data Solutions',
  'TierPoint',
  // West Coast / CA-pilot additions (verified from OSM data):
  'Hurricane Electric', // backbone carrier + colo; large Fremont campus (HE.net)
  'EdgeConneX', // wholesale/hyperscale-edge colo; multiple CA campuses
  'OpenColo', // Santa Clara colo operator
  'LightEdge', // colo with multiple US locations; SAN1 campus in San Diego
  'TPx Communications', // SoCal colo operator (formerly TelePacific)
  'One Wilshire', // landmark LA carrier hotel / colocation exchange
  'SV Colo', // Santa Clara colo
]);

// OSM names that imply a single building within a larger campus.
// When the slug represents a multi-building dedup cluster (the 500m radius
// collapses many ways into one record), the OSM `name` of the first-seen
// building is misleading as the canonical facility name. Substitute
// "{operator} {city}" for known operators when these patterns appear.
// Example: OSM way 460175672 ("AWS Building E") → "Amazon Web Services Ashburn".
const BUILDING_NAME_PATTERN = /\b(Building|Block|Phase|Wing|Tower|Bldg|DC)\s*[A-Z0-9]+/i;

// Known OSM tagging mistakes that pass the data_center quality filter but
// represent non-data-center venues. The cleanest fix would be to also check
// for conflicting primary tags (leisure=fitness_centre, tourism=hotel, etc.)
// but those vary by venue type. For now we hard-skip by OSM ID; expand the
// list as future state pilots surface more false positives.
const OSM_FALSE_POSITIVE_IDS = new Set<string>([
  'way/300970761', // Golds Gym Ashburn (telecom=data_center applied to a gym)
  'way/30666790', // USPS Terminal Annex Los Angeles (federal mail sorting facility, not a commercial DC)
]);

// ---------------------------------------------------------------------------
// Slugify helper — converts arbitrary text to kebab-case safe slug
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '') // strip non-alphanumeric except spaces/hyphens
    .trim()
    .replace(/\s+/g, '-') // spaces → hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, ''); // strip leading/trailing hyphens
}

// ---------------------------------------------------------------------------
// Operator normalization
// ---------------------------------------------------------------------------

export function normalizeOperator(raw: string): string {
  return OPERATOR_ALIASES[raw.trim()] ?? raw.trim();
}

// ---------------------------------------------------------------------------
// Tenant type derivation
// ---------------------------------------------------------------------------

export function deriveTenantType(operator: string): 'hyperscaler' | 'colo' | 'enterprise' {
  if (HYPERSCALERS.has(operator)) return 'hyperscaler';
  if (COLOS.has(operator)) return 'colo';
  return 'enterprise';
}

// ---------------------------------------------------------------------------
// Haversine distance in meters — for 500m proximity dedup
// ---------------------------------------------------------------------------

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// CONUS bbox filter
// ---------------------------------------------------------------------------

export function isWithinConusBbox(lat: number, lon: number): boolean {
  const [minLat, minLon, maxLat, maxLon] = CONUS_BBOX;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

// ---------------------------------------------------------------------------
// Normalize OSM element → the shape we'll write to YAML
// Returns null if element should be skipped (quality filter)
// ---------------------------------------------------------------------------

export interface NormalizedFacility {
  slug: string;
  name: string;
  operator: string;
  tenant_type: 'hyperscaler' | 'colo' | 'enterprise';
  status: 'operational';
  location: { lng: number; lat: number };
  address?: string;
  city: string;
  state?: string;
  confidence: 'low';
  osmType: 'way' | 'relation';
  osmId: number;
  sourceUrl: string;
  /** Fields the OSM source actually provided */
  supportedFields: string[];
}

export function normalizeOsmElement(
  element: OsmElement,
  today: string,
  /** State code from the --state argument; used to fill in slug + state field
   * when the OSM element lacks addr:state. Keeps slugs consistent even when
   * the OSM mapper didn't tag addr:state. */
  queryState?: string
): NormalizedFacility | null {
  // Only import way + relation geometry — nodes are junk pins
  if (element.type === 'node') return null;

  const tags = element.tags ?? {};
  const center = element.center;
  if (!center) return null;

  const { lat, lon } = center;

  // CONUS filter — log but don't fail
  if (!isWithinConusBbox(lat, lon)) return null;

  const rawName = tags['name'];
  const rawOperator = tags['operator'];

  // Skip if neither name nor operator is present — can't make a meaningful slug
  if (!rawName && !rawOperator) return null;

  // Skip known OSM tagging mistakes (gyms etc. mis-tagged as data centers)
  if (OSM_FALSE_POSITIVE_IDS.has(`${element.type}/${element.id}`)) return null;

  const operator = normalizeOperator(rawOperator ?? rawName ?? '');

  const city = tags['addr:city'];
  // Skip if we can't determine the city — slug generation requires it
  if (!city) return null;

  // Name: prefer OSM name, but substitute "{operator} {city}" when the OSM
  // name looks like a single-building reference inside a larger campus
  // (e.g. "AWS Building E") and we have a known operator. This avoids
  // labeling a deduped campus record with one arbitrary building's name.
  const isKnownOperator = HYPERSCALERS.has(operator) || COLOS.has(operator);
  const looksLikeOneBuilding =
    rawName != null && isKnownOperator && BUILDING_NAME_PATTERN.test(rawName);
  const name = looksLikeOneBuilding
    ? `${operator} ${city}`
    : (rawName ?? `${operator} Data Center`);

  // State: prefer OSM addr:state, fall back to the --state query argument
  const addrState = tags['addr:state'] ?? queryState;

  // Build slug: {operator-slug}-{city-slug}-{state-lower}
  const stateSlug = addrState ? addrState.toLowerCase() : '';
  const slug = [slugify(operator), slugify(city), stateSlug].filter(Boolean).join('-');

  if (!slug) return null;

  // Address only if both housenumber + street are present (sourcing rule)
  const houseNumber = tags['addr:housenumber'];
  const street = tags['addr:street'];
  // Only include state in address string when we have it from OSM (not inferred from query)
  const addrStateFromOsm = tags['addr:state'];
  const address =
    houseNumber && street
      ? `${houseNumber} ${street}, ${city}${addrStateFromOsm ? ', ' + addrStateFromOsm : ''}`
      : undefined;

  const osmType = element.type as 'way' | 'relation';
  const sourceUrl = `https://www.openstreetmap.org/${osmType}/${element.id}`;

  // Build the supports list from what OSM actually gave us
  const supportedFields: string[] = ['location'];
  if (rawName) supportedFields.push('name');
  if (rawOperator) supportedFields.push('operator');
  if (city) supportedFields.push('city');
  if (addrState) supportedFields.push('state');

  const tenant_type = deriveTenantType(operator);

  // today is injected by caller so tests can freeze the date
  void today; // used in YAML comment block written by the caller

  return {
    slug,
    name,
    operator,
    tenant_type,
    status: 'operational',
    location: { lng: parseFloat(lon.toFixed(7)), lat: parseFloat(lat.toFixed(7)) },
    ...(address ? { address } : {}),
    city,
    ...(addrState ? { state: addrState } : {}),
    confidence: 'low',
    osmType,
    osmId: element.id,
    sourceUrl,
    supportedFields,
  };
}

// ---------------------------------------------------------------------------
// Dedup logic
// ---------------------------------------------------------------------------

export interface ExistingFacility {
  slug: string;
  lat: number;
  lng: number;
}

/** Returns the matching existing slug if deduped, or null if it's a new record */
export function shouldDedup(
  incoming: NormalizedFacility,
  existingFacilities: ExistingFacility[],
  radiusMeters = 500
): string | null {
  for (const existing of existingFacilities) {
    if (incoming.slug === existing.slug) return existing.slug;
    const dist = haversineMeters(
      incoming.location.lat,
      incoming.location.lng,
      existing.lat,
      existing.lng
    );
    if (dist < radiusMeters) return existing.slug;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Load existing curated facilities for dedup
// ---------------------------------------------------------------------------

function loadExistingFacilities(facilitiesDir: string): ExistingFacility[] {
  const results: ExistingFacility[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
        try {
          const raw = parseYaml(readFileSync(fullPath, 'utf-8'), { merge: false }) as Record<
            string,
            unknown
          >;
          const slug = raw['slug'];
          const loc = raw['location'] as { lat?: number; lng?: number } | undefined;
          if (typeof slug === 'string' && loc?.lat !== undefined && loc?.lng !== undefined) {
            results.push({ slug, lat: loc.lat, lng: loc.lng });
          }
        } catch {
          // Malformed YAML — ignore for dedup purposes; validate.ts will catch it
        }
      }
    }
  }

  walk(facilitiesDir);
  return results;
}

// Node.js imports needed for the walk function — keep at bottom to avoid
// polluting the pure-logic exports above (which are tested in isolation).
import { readdirSync, statSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Render a NormalizedFacility to a YAML string with provenance header
// ---------------------------------------------------------------------------

function renderYaml(facility: NormalizedFacility, today: string): string {
  const { osmType, osmId, sourceUrl, supportedFields, ...rest } = facility;
  void osmType;
  void osmId;

  // Build the YAML object (no extra internal fields)
  const obj: Record<string, unknown> = {
    slug: rest.slug,
    name: rest.name,
    operator: rest.operator,
    tenant_type: rest.tenant_type,
    status: rest.status,
    location: rest.location,
    ...(rest.address ? { address: rest.address } : {}),
    ...(rest.city ? { city: rest.city } : {}),
    ...(rest.state ? { state: rest.state } : {}),
    confidence: rest.confidence,
    last_verified: today,
    sources: [
      {
        url: sourceUrl,
        accessed_at: today,
        supports: supportedFields,
      },
    ],
  };

  const header = [
    `# Auto-imported from OpenStreetMap on ${today} via scripts/osm-import.ts.`,
    `# All fields below are from OSM tags; nothing has been independently verified.`,
    `# Curators: upgrade \`confidence\` to \`medium\` after cross-checking against a`,
    `# secondary source (utility filings, county GIS, trade press). See`,
    `# data/facilities/README.md for the sourcing hierarchy.`,
  ].join('\n');

  // Fields intentionally omitted comment
  const omitted = [
    `# Fields intentionally omitted — OSM does not reliably tag these values:`,
    `#   acres, sqft, year_built, it_load_mw, total_mw, design_pue, cooling_type`,
    `#   water_source, construction_capex_usd, jobs_construction, jobs_permanent`,
    `#   reported_annual_mwh, reported_annual_gallons, power_sources, subsidies`,
    `#   fips (leave null; a future curation pass fills this in via Census Geocoder)`,
  ].join('\n');

  const yamlBody = stringifyYaml(obj, {
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
    lineWidth: 0,
  });

  return `${header}\n${omitted}\n${yamlBody}`;
}

// ---------------------------------------------------------------------------
// Overpass API query
// ---------------------------------------------------------------------------

// Overpass instances in priority order. z.overpass-api.de works from this host
// when overpass-api.de itself returns 406 (a known per-IP rate-limit variant).
const OVERPASS_ENDPOINTS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function queryOverpass(
  bbox: [number, number, number, number],
  timeoutSec = 120
): Promise<OverpassResponse> {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const bboxStr = `${minLat},${minLon},${maxLat},${maxLon}`;

  // Union all five tag flavors for way + relation; skip nodes (junk pins)
  const query = [
    `[out:json][timeout:${timeoutSec}];`,
    `(`,
    `  way["amenity"="data_center"](${bboxStr});`,
    `  way["industrial"="data_center"](${bboxStr});`,
    `  way["telecom"="data_center"](${bboxStr});`,
    `  way["building"="data_center"](${bboxStr});`,
    `  way["man_made"="data_center"](${bboxStr});`,
    `  relation["amenity"="data_center"](${bboxStr});`,
    `  relation["industrial"="data_center"](${bboxStr});`,
    `  relation["telecom"="data_center"](${bboxStr});`,
    `  relation["building"="data_center"](${bboxStr});`,
    `  relation["man_made"="data_center"](${bboxStr});`,
    `);`,
    `out center tags;`,
  ].join('\n');

  let lastErr: Error = new Error('No Overpass endpoints tried');

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'usdatacenterwatch-osm-import/1.0 (civic transparency; https://github.com/zzulanas/usdatacenterwatch)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout((timeoutSec + 30) * 1000),
      });

      if (!resp.ok) {
        lastErr = new Error(`HTTP ${resp.status} from ${endpoint}`);
        continue;
      }

      const text = await resp.text();

      // Overpass sometimes returns XML error even with 200 OK
      if (text.startsWith('<') && text.includes('Error')) {
        lastErr = new Error(`Overpass error from ${endpoint}: ${text.slice(0, 200)}`);
        continue;
      }

      const data = JSON.parse(text) as OverpassResponse;
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // try next endpoint
    }
  }

  throw lastErr;
}

// ---------------------------------------------------------------------------
// Main CLI entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const importAll = args.includes('--all');

  let targetStates: string[] = [];

  if (importAll) {
    targetStates = Object.keys(STATE_BBOXES).sort();
    console.log(`Importing all ${targetStates.length} states.`);
  } else {
    const stateIdx = args.indexOf('--state');
    if (stateIdx === -1 || !args[stateIdx + 1]) {
      console.error('Usage: pnpm osm-import --state VA [--dry-run]');
      console.error('       pnpm osm-import --all [--dry-run]');
      process.exit(1);
    }
    const stateArg = args[stateIdx + 1]!.toUpperCase();
    if (!STATE_BBOXES[stateArg]) {
      console.error(`Unknown state: ${stateArg}. Must be a 2-letter CONUS postal code.`);
      process.exit(1);
    }
    targetStates = [stateArg];
  }

  if (dryRun) {
    console.log('DRY RUN — no files will be written.\n');
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(__dirname, '..');
  const facilitiesDir = join(projectRoot, 'data', 'facilities');

  // Load existing facilities for dedup
  console.log('Loading existing curated facilities for dedup…');
  const existingFacilities = loadExistingFacilities(facilitiesDir);
  const existingSlugs = new Set(existingFacilities.map((f) => f.slug));
  console.log(`  Found ${existingFacilities.length} existing facilities.\n`);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let totalImported = 0;
  let totalSkippedDedup = 0;
  let totalSkippedQuality = 0;

  for (const state of targetStates) {
    const bbox = STATE_BBOXES[state]!;
    console.log(`[${state}] Querying Overpass API for bbox ${bbox.join(',')}…`);

    let response: OverpassResponse;
    try {
      response = await queryOverpass(bbox);
    } catch (err) {
      console.error(
        `[${state}] Overpass query failed: ${err instanceof Error ? err.message : err}`
      );
      console.error(`[${state}] STOPPING — report this blocker. Do not proceed with partial data.`);
      process.exit(1);
    }

    console.log(`[${state}]   Received ${response.elements.length} raw elements.`);

    // Track slugs seen within this run to dedup within the batch too
    const batchSlugs = new Set<string>(existingSlugs);

    let stateImported = 0;
    let stateSkippedDedup = 0;
    let stateSkippedQuality = 0;

    for (const element of response.elements) {
      const normalized = normalizeOsmElement(element, today, state);

      if (!normalized) {
        stateSkippedQuality++;
        continue;
      }

      // Dedup against existing curated + already-written batch
      const dedupMatch = shouldDedup(normalized, existingFacilities);
      const batchDuplicate = batchSlugs.has(normalized.slug);

      if (dedupMatch || batchDuplicate) {
        const reason = dedupMatch ?? normalized.slug;
        console.log(`[${state}]   skip dedup: ${normalized.slug} (matches: ${reason})`);
        stateSkippedDedup++;
        continue;
      }

      batchSlugs.add(normalized.slug);

      // Route by the record's actual state (from OSM addr:state) rather than
      // the CLI arg — Overpass bbox queries cross state lines, so a `--state VA`
      // run can legitimately return MD/KY/WV records and they belong in their
      // own state directories. Fall back to the CLI arg only when OSM lacks
      // addr:state and the normalizer couldn't derive one.
      const targetState = (normalized.state ?? state).toLowerCase();
      const stateDir = join(facilitiesDir, targetState);
      const filePath = join(stateDir, `${normalized.slug}.yaml`);
      const yaml = renderYaml(normalized, today);

      if (dryRun) {
        console.log(`[${state}]   DRY RUN would write: ${filePath}`);
        console.log(yaml.split('\n').slice(0, 12).join('\n'));
        console.log('  ...');
      } else {
        if (!existsSync(stateDir)) {
          mkdirSync(stateDir, { recursive: true });
        }
        writeFileSync(filePath, yaml, 'utf-8');
        console.log(`[${state}]   wrote: data/facilities/${targetState}/${normalized.slug}.yaml`);
      }

      // Within-batch proximity dedup: subsequent records get to see this one
      // as "existing" so a campus that spans two raw Overpass results doesn't
      // produce duplicate slugs from two close-together buildings.
      existingFacilities.push({
        slug: normalized.slug,
        lat: normalized.location.lat,
        lng: normalized.location.lng,
      });

      stateImported++;
    }

    console.log(
      `[${state}] Done: imported=${stateImported} skipped_dedup=${stateSkippedDedup} skipped_quality=${stateSkippedQuality}\n`
    );

    totalImported += stateImported;
    totalSkippedDedup += stateSkippedDedup;
    totalSkippedQuality += stateSkippedQuality;
  }

  console.log(
    `Summary: Imported ${totalImported} (skipped ${totalSkippedDedup} for dedup, ${totalSkippedQuality} for quality)`
  );
}

// Only run main when this file is the entry point (not when imported by tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('osm-import failed:', err);
    process.exit(1);
  });
}
