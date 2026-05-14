/**
 * filters.ts — pure filter logic for the map.
 *
 * No React, no Zustand, no DOM. The store wires these into reactive state and
 * URL serialization, but the predicates and parsers are tested in isolation.
 *
 * Filter semantics (USD-18):
 *   - Multi-select fields (operator, tenant type, status, cooling, state):
 *     OR within a category, AND across categories.
 *   - MW range and year range: when the slider is at full extent (== facet
 *     bounds, internally represented as `null`), facilities with unknown
 *     MW / year are included. As soon as the user moves a thumb, unknown
 *     facilities are filtered out.
 *   - Status default: { operational, under_construction, announced }.
 *     Decommissioned is hidden until the user explicitly opts in.
 */

import type { FacilityForMap } from '@/lib/load-facilities';
import type { CoolingType, StatusType, TenantType } from '@/lib/zod-facility-schema';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FilterState {
  /** Multi-select on `facility.operator`. [] = no filter. */
  operators: string[];
  /** Multi-select on `facility.tenant_type`. [] = no filter. */
  tenantTypes: TenantType[];
  /** Multi-select on `facility.status`. Default = STATUS_DEFAULT (decommissioned hidden). */
  statuses: StatusType[];
  /** Multi-select on `facility.cooling_type`. [] = no filter. */
  coolingTypes: CoolingType[];
  /** Multi-select on `facility.state` (two-letter code). [] = no filter. */
  states: string[];
  /** [lo, hi] in MW. null = "not engaged" — unknown-MW facilities pass through. */
  mwRange: [number, number] | null;
  /** [lo, hi] in calendar year. null = "not engaged" — unknown-year facilities pass through. */
  yearRange: [number, number] | null;
}

export interface FacetOptions {
  /** Sorted unique operator strings derived from the loaded dataset. */
  operators: string[];
  /** Sorted unique two-letter state codes. */
  states: string[];
  /** Enum values for tenant_type from the schema, in canonical order. */
  tenantTypes: readonly TenantType[];
  /** Enum values for status from the schema. UI presents these as chips. */
  statuses: readonly StatusType[];
  /** Enum values for cooling_type from the schema. */
  coolingTypes: readonly CoolingType[];
  /** [floor, ceil] in MW. Falls back to MW_FALLBACK_BOUNDS when no data has MW. */
  mwBounds: [number, number];
  /** [oldest, newest] calendar years from year_built. Falls back to YEAR_FALLBACK_BOUNDS. */
  yearBounds: [number, number];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default status filter — decommissioned is hidden until user opts in. */
export const STATUS_DEFAULT: readonly StatusType[] = [
  'operational',
  'under_construction',
  'announced',
];

/** Enum order, mirrored from zod-facility-schema for stable UI presentation. */
const TENANT_TYPES: readonly TenantType[] = ['hyperscaler', 'colo', 'crypto', 'enterprise'];
const STATUSES: readonly StatusType[] = [
  'operational',
  'under_construction',
  'announced',
  'decommissioned',
];
const COOLING_TYPES: readonly CoolingType[] = ['air', 'evap', 'liquid', 'hybrid'];

/** Sentinel bounds when the dataset has no MW / year data (seed-mode dev). */
const MW_FALLBACK_BOUNDS: [number, number] = [0, 1000];
const YEAR_FALLBACK_BOUNDS: [number, number] = [2000, new Date().getFullYear()];

/** A FilterState with every category cleared and statuses at default. */
export const EMPTY_FILTERS: FilterState = {
  operators: [],
  tenantTypes: [],
  statuses: [...STATUS_DEFAULT],
  coolingTypes: [],
  states: [],
  mwRange: null,
  yearRange: null,
};

// ---------------------------------------------------------------------------
// Facet derivation
// ---------------------------------------------------------------------------

export function deriveFacetOptions(facilities: FacilityForMap[]): FacetOptions {
  const operatorSet = new Set<string>();
  const stateSet = new Set<string>();

  let mwMin = Infinity;
  let mwMax = -Infinity;
  let yearMin = Infinity;
  let yearMax = -Infinity;

  for (const f of facilities) {
    if (f.operator) operatorSet.add(f.operator);
    if (f.state) stateSet.add(f.state);

    if (typeof f.mw === 'number' && f.mw > 0) {
      mwMin = Math.min(mwMin, f.mw);
      mwMax = Math.max(mwMax, f.mw);
    }

    if (typeof f.year_built === 'number') {
      yearMin = Math.min(yearMin, f.year_built);
      yearMax = Math.max(yearMax, f.year_built);
    }
  }

  const mwBounds: [number, number] =
    Number.isFinite(mwMin) && Number.isFinite(mwMax) && mwMax > mwMin
      ? [Math.floor(mwMin), Math.ceil(mwMax)]
      : MW_FALLBACK_BOUNDS;

  const yearBounds: [number, number] =
    Number.isFinite(yearMin) && Number.isFinite(yearMax) && yearMax >= yearMin
      ? [Math.floor(yearMin), Math.ceil(yearMax)]
      : YEAR_FALLBACK_BOUNDS;

  return {
    operators: Array.from(operatorSet).sort((a, b) => a.localeCompare(b)),
    states: Array.from(stateSet).sort((a, b) => a.localeCompare(b)),
    tenantTypes: TENANT_TYPES,
    statuses: STATUSES,
    coolingTypes: COOLING_TYPES,
    mwBounds,
    yearBounds,
  };
}

// ---------------------------------------------------------------------------
// Filter application
// ---------------------------------------------------------------------------

/**
 * Filter a facility array by the current filter state.
 * Predicate ordering is cheapest-first (single-prop equality checks before
 * range comparisons) — at 5k facilities the full pass is sub-millisecond.
 */
export function applyFilters(facilities: FacilityForMap[], filters: FilterState): FacilityForMap[] {
  return facilities.filter((f) => {
    // Status — multi-select with a non-empty default (decommissioned hidden).
    // statuses is never empty in practice (UI prevents that), but defend.
    if (filters.statuses.length > 0) {
      const s = f.status ?? 'operational';
      if (!filters.statuses.includes(s)) return false;
    }

    if (filters.tenantTypes.length > 0) {
      if (!f.tenant_type || !filters.tenantTypes.includes(f.tenant_type)) return false;
    }

    if (filters.states.length > 0) {
      if (!f.state || !filters.states.includes(f.state)) return false;
    }

    if (filters.coolingTypes.length > 0) {
      if (!f.cooling_type || !filters.coolingTypes.includes(f.cooling_type)) return false;
    }

    if (filters.operators.length > 0) {
      if (!filters.operators.includes(f.operator)) return false;
    }

    // MW range. Engaged range excludes unknown / zero-MW facilities; null
    // (full-extent) passes them through.
    if (filters.mwRange) {
      const [lo, hi] = filters.mwRange;
      if (typeof f.mw !== 'number' || f.mw <= 0) return false;
      if (f.mw < lo || f.mw > hi) return false;
    }

    if (filters.yearRange) {
      const [lo, hi] = filters.yearRange;
      if (typeof f.year_built !== 'number') return false;
      if (f.year_built < lo || f.year_built > hi) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// URL serialization
// ---------------------------------------------------------------------------

/**
 * Serialize filters to a Patch (Record<string, string | null>) suitable for
 * `patchUrl` in url-state.ts. Keys at default or no-filter values are mapped
 * to null so patchUrl will delete them — keeping shared URLs minimal.
 */
export function serializeFilters(
  filters: FilterState,
  facets: FacetOptions
): Record<string, string | null> {
  return {
    o: filters.operators.length > 0 ? filters.operators.join(',') : null,
    t: filters.tenantTypes.length > 0 ? filters.tenantTypes.join(',') : null,
    s: arraysEqualAsSets(filters.statuses, STATUS_DEFAULT) ? null : filters.statuses.join(','),
    c: filters.coolingTypes.length > 0 ? filters.coolingTypes.join(',') : null,
    st: filters.states.length > 0 ? filters.states.join(',') : null,
    mw: serializeRange(filters.mwRange, facets.mwBounds),
    yr: serializeRange(filters.yearRange, facets.yearBounds),
  };
}

function serializeRange(range: [number, number] | null, bounds: [number, number]): string | null {
  if (!range) return null;
  if (range[0] === bounds[0] && range[1] === bounds[1]) return null;
  return `${range[0]}-${range[1]}`;
}

function arraysEqualAsSets<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((x) => seen.has(x));
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a FilterState from URLSearchParams. Unknown enum values are dropped
 * (a stale URL with a removed operator yields zero results, not a crash).
 * Ranges are clamped to facet bounds, then collapsed to null when they cover
 * the full extent — same drop-when-default rule as serializeFilters.
 */
export function parseFiltersFromUrl(params: URLSearchParams, facets: FacetOptions): FilterState {
  // Status: ABSENT → default; PRESENT → exact set (even if it's a single value)
  const statusRaw = params.get('s');
  const statuses: StatusType[] =
    statusRaw === null
      ? [...STATUS_DEFAULT]
      : parseCsvFromEnum<StatusType>(statusRaw, facets.statuses);

  return {
    operators: parseCsvAllowFreeform(params.get('o')),
    tenantTypes: parseCsvFromEnum<TenantType>(params.get('t'), facets.tenantTypes),
    statuses,
    coolingTypes: parseCsvFromEnum<CoolingType>(params.get('c'), facets.coolingTypes),
    states: parseCsvAllowFreeform(params.get('st')).map((s) => s.toUpperCase()),
    mwRange: parseRange(params.get('mw'), facets.mwBounds),
    yearRange: parseRange(params.get('yr'), facets.yearBounds),
  };
}

function parseCsvFromEnum<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const allowedSet = new Set(allowed);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => allowedSet.has(s as T));
}

function parseCsvAllowFreeform(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseRange(raw: string | null, bounds: [number, number]): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split('-').map((s) => Number(s.trim()));
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const lo = Math.max(bounds[0], Math.min(a!, b!));
  const hi = Math.min(bounds[1], Math.max(a!, b!));
  if (lo === bounds[0] && hi === bounds[1]) return null;
  if (lo > hi) return null;
  return [lo, hi];
}

// ---------------------------------------------------------------------------
// Predicates for UI affordances
// ---------------------------------------------------------------------------

/** True if any filter deviates from "no filter" / default values. */
export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.operators.length > 0 ||
    filters.tenantTypes.length > 0 ||
    !arraysEqualAsSets(filters.statuses, STATUS_DEFAULT) ||
    filters.coolingTypes.length > 0 ||
    filters.states.length > 0 ||
    filters.mwRange !== null ||
    filters.yearRange !== null
  );
}

/** Count of active filter dimensions, for a "Filters (3)" badge. */
export function activeFilterCount(filters: FilterState): number {
  let n = 0;
  if (filters.operators.length > 0) n++;
  if (filters.tenantTypes.length > 0) n++;
  if (!arraysEqualAsSets(filters.statuses, STATUS_DEFAULT)) n++;
  if (filters.coolingTypes.length > 0) n++;
  if (filters.states.length > 0) n++;
  if (filters.mwRange !== null) n++;
  if (filters.yearRange !== null) n++;
  return n;
}
