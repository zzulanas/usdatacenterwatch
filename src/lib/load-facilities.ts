/**
 * load-facilities.ts — fetches the facilities dataset from R2 at runtime.
 *
 * Fetch path (when PUBLIC_R2_BASE_URL is set):
 *   1. GET ${PUBLIC_R2_BASE_URL}/manifest.json
 *   2. Read manifest.facilities_url → GET ${PUBLIC_R2_BASE_URL}/<facilities-{hash}.json.gz>
 *   3. Browser decompresses gzip transparently (Content-Encoding: gzip).
 *
 * Fallback (when PUBLIC_R2_BASE_URL is not set, or fetch fails):
 *   Returns SEED_FACILITIES from src/data/facilities.ts with a console warning.
 *   This keeps local dev without R2 fully functional.
 *
 * The returned type is intentionally compatible with the Facility interface in
 * src/data/facilities.ts so MapView.tsx can consume either source identically.
 * The R2 dataset carries extra fields (tenant_type, status, estimate, etc.)
 * that the map ignores for now — they're available for future UI enhancements.
 */

import { SEED_FACILITIES, type Facility } from '@/data/facilities';
import type {
  CoolingType,
  StatusType,
  TenantType,
  WaterSourceType,
} from '@/lib/zod-facility-schema';

// ---------------------------------------------------------------------------
// Manifest + dataset types (subset of the full R2 dataset shape)
// ---------------------------------------------------------------------------

interface Manifest {
  version: string;
  generated_at: string;
  facilities_url: string;
  facility_count: number;
  methodology_version: string;
}

/** Minimal R2 facility record — superset of src/data/facilities.ts Facility */
export interface FacilityFromR2 {
  slug: string;
  name: string;
  operator: string;
  tenant_type: TenantType;
  /** Lifecycle stage — same union as Facility.status; mirrors the Zod enum. */
  status: StatusType;
  location: { lng: number; lat: number };
  // Derived from location for MapView compat
  lng: number;
  lat: number;
  it_load_mw: number | null;
  total_mw: number | null;
  confidence: 'high' | 'medium' | 'low';
  // Filterable fields: explicitly typed so MapFilters predicates compile against
  // the schema rather than dipping into the [key:string]:unknown catchall. These
  // are optional in the Zod schema (some YAML records lack them); MapFilters
  // handles undefined as "no value".
  cooling_type?: CoolingType | null;
  year_built?: number | null;
  state?: string | null;
  water_source?: WaterSourceType | null;
  sources: Array<{ url: string; accessed_at: string; supports: string[] }>;
  estimate: {
    methodology_version: string;
    annual_gwh: number;
    annual_gwh_low: number;
    annual_gwh_high: number;
    annual_gallons: number;
    annual_gallons_low: number;
    annual_gallons_high: number;
    inputs: unknown;
    computed_at: string;
  } | null;
  // Preserve everything else as-is for forward compat
  [key: string]: unknown;
}

/** Shape returned to callers — compatible with MapView Facility */
export interface FacilityForMap extends Facility {
  // Extra fields available when loaded from R2 (undefined when using seed data)
  tenant_type?: TenantType;
  // `status` is already on Facility but typed as a narrow union there; this
  // alias keeps the field discoverable on the R2-side type without widening.
  status?: Facility['status'];
  estimate?: FacilityFromR2['estimate'];
  // Filterable fields — same explicit typing as FacilityFromR2 so MapFilters
  // and other consumers can read them without an `as unknown as` cast.
  cooling_type?: CoolingType | null;
  year_built?: number | null;
  state?: string | null;
  water_source?: WaterSourceType | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads facilities from R2 if PUBLIC_R2_BASE_URL is set; falls back to
 * SEED_FACILITIES otherwise.
 *
 * Always resolves (never rejects) — errors produce a warning + fallback.
 */
export async function loadFacilities(): Promise<FacilityForMap[]> {
  const base = import.meta.env.PUBLIC_R2_BASE_URL as string | undefined;

  if (!base) {
    console.warn(
      '[load-facilities] PUBLIC_R2_BASE_URL not set — using seed facilities. ' +
        'Set this env var to load live data from R2.'
    );
    return SEED_FACILITIES as FacilityForMap[];
  }

  try {
    // Step 1: fetch manifest
    const manifestRes = await fetch(`${base}/manifest.json`, {
      cache: 'no-store', // always get the latest manifest pointer
    });
    if (!manifestRes.ok) {
      throw new Error(
        `manifest.json fetch failed: ${manifestRes.status} ${manifestRes.statusText}`
      );
    }
    const manifest = (await manifestRes.json()) as Manifest;

    // Step 2: fetch the versioned facilities file
    // The browser decompresses Content-Encoding: gzip transparently.
    const dataRes = await fetch(`${base}/${manifest.facilities_url}`, {
      cache: 'force-cache', // hash in key → safe to cache indefinitely
    });
    if (!dataRes.ok) {
      throw new Error(
        `facilities fetch failed: ${dataRes.status} ${dataRes.statusText} (${manifest.facilities_url})`
      );
    }

    const dataset = (await dataRes.json()) as {
      facilities: FacilityFromR2[];
    };

    // Normalize: add top-level lng/lat for MapView compat, and a source_url
    // pointing at the first source entry (matching the Facility interface).
    return dataset.facilities.map((f) => ({
      ...f,
      lng: f.location.lng,
      lat: f.location.lat,
      // mw: prefer total_mw, fall back to it_load_mw, then 0
      mw: f.total_mw ?? f.it_load_mw ?? 0,
      source_url:
        Array.isArray(f.sources) && f.sources.length > 0 && f.sources[0]?.url
          ? f.sources[0].url
          : '',
    }));
  } catch (err) {
    console.warn(
      '[load-facilities] Failed to load facilities from R2 — falling back to seed data.',
      err
    );
    return SEED_FACILITIES as FacilityForMap[];
  }
}
