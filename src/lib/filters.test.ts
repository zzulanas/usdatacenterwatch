import { describe, it, expect } from 'vitest';
import type { FacilityForMap } from '@/lib/load-facilities';
import {
  applyFilters,
  deriveFacetOptions,
  serializeFilters,
  parseFiltersFromUrl,
  hasActiveFilters,
  activeFilterCount,
  STATUS_DEFAULT,
  EMPTY_FILTERS,
  type FilterState,
} from './filters';

function f(overrides: Partial<FacilityForMap>): FacilityForMap {
  return {
    slug: overrides.slug ?? 'test',
    name: overrides.name ?? 'Test',
    operator: overrides.operator ?? 'TestCo',
    lat: 0,
    lng: 0,
    mw: overrides.mw ?? 100,
    confidence: 'medium',
    source_url: '',
    ...overrides,
  } as FacilityForMap;
}

const FIXTURES: FacilityForMap[] = [
  f({
    slug: 'meta-a',
    operator: 'Meta',
    tenant_type: 'hyperscaler',
    status: 'operational',
    cooling_type: 'evap',
    state: 'VA',
    year_built: 2020,
    mw: 500,
  }),
  f({
    slug: 'google-a',
    operator: 'Google',
    tenant_type: 'hyperscaler',
    status: 'operational',
    cooling_type: 'air',
    state: 'IA',
    year_built: 2015,
    mw: 200,
  }),
  f({
    slug: 'aws-a',
    operator: 'AWS',
    tenant_type: 'hyperscaler',
    status: 'under_construction',
    cooling_type: 'liquid',
    state: 'VA',
    year_built: 2024,
    mw: 800,
  }),
  f({
    slug: 'decom-a',
    operator: 'OldCo',
    tenant_type: 'enterprise',
    status: 'decommissioned',
    cooling_type: 'air',
    state: 'NY',
    year_built: 1995,
    mw: 50,
  }),
  // No MW, no year — these test the "unknown" passthrough behavior.
  f({
    slug: 'unknown-a',
    operator: 'NewCo',
    tenant_type: 'colo',
    status: 'announced',
    state: 'TX',
    mw: 0,
  }),
];

// ---------------------------------------------------------------------------
// deriveFacetOptions
// ---------------------------------------------------------------------------

describe('deriveFacetOptions', () => {
  it('extracts unique sorted operators and states', () => {
    const facets = deriveFacetOptions(FIXTURES);
    expect(facets.operators).toEqual(['AWS', 'Google', 'Meta', 'NewCo', 'OldCo']);
    expect(facets.states).toEqual(['IA', 'NY', 'TX', 'VA']);
  });

  it('computes mw bounds from positive-mw facilities only', () => {
    const facets = deriveFacetOptions(FIXTURES);
    expect(facets.mwBounds).toEqual([50, 800]);
  });

  it('computes year bounds from facilities with year_built', () => {
    const facets = deriveFacetOptions(FIXTURES);
    expect(facets.yearBounds).toEqual([1995, 2024]);
  });

  it('falls back to sentinel bounds when no MW data is present', () => {
    const noMw = [f({ mw: 0 }), f({ mw: 0 })];
    const facets = deriveFacetOptions(noMw);
    expect(facets.mwBounds).toEqual([0, 1000]);
  });

  it('falls back to sentinel year bounds when no year data is present', () => {
    const noYear = [f({ mw: 100 })];
    const facets = deriveFacetOptions(noYear);
    expect(facets.yearBounds[0]).toBe(2000);
    expect(facets.yearBounds[1]).toBeGreaterThanOrEqual(2026);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — semantics
// ---------------------------------------------------------------------------

describe('applyFilters', () => {
  it('with EMPTY_FILTERS, hides decommissioned (status default rule)', () => {
    const out = applyFilters(FIXTURES, EMPTY_FILTERS);
    expect(out.map((x) => x.slug)).toEqual(['meta-a', 'google-a', 'aws-a', 'unknown-a']);
  });

  it('OR within a category: operator multi-select', () => {
    const filters: FilterState = { ...EMPTY_FILTERS, operators: ['Meta', 'Google'] };
    const out = applyFilters(FIXTURES, filters);
    expect(out.map((x) => x.slug).sort()).toEqual(['google-a', 'meta-a']);
  });

  it('AND across categories: operator AND state AND status', () => {
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      operators: ['Meta', 'AWS'],
      states: ['VA'],
      statuses: ['operational'],
    };
    const out = applyFilters(FIXTURES, filters);
    expect(out.map((x) => x.slug)).toEqual(['meta-a']);
  });

  it('MW range filters out facilities with unknown / zero mw', () => {
    const filters: FilterState = { ...EMPTY_FILTERS, mwRange: [100, 1000] };
    const out = applyFilters(FIXTURES, filters);
    expect(out.map((x) => x.slug).sort()).toEqual(['aws-a', 'google-a', 'meta-a']);
    expect(out.find((x) => x.slug === 'unknown-a')).toBeUndefined();
  });

  it('MW range null lets unknown-mw facilities pass through', () => {
    // EMPTY_FILTERS has mwRange: null and includes unknown-a (status=announced is in default)
    const out = applyFilters(FIXTURES, EMPTY_FILTERS);
    expect(out.find((x) => x.slug === 'unknown-a')).toBeDefined();
  });

  it('year range filters out unknown-year facilities', () => {
    const filters: FilterState = { ...EMPTY_FILTERS, yearRange: [2010, 2025] };
    const out = applyFilters(FIXTURES, filters);
    // unknown-a has no year_built → excluded; meta-a (2020), google-a (2015), aws-a (2024) pass
    expect(out.map((x) => x.slug).sort()).toEqual(['aws-a', 'google-a', 'meta-a']);
  });

  it('decommissioned visible only when explicitly selected', () => {
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      statuses: ['decommissioned'],
    };
    const out = applyFilters(FIXTURES, filters);
    expect(out.map((x) => x.slug)).toEqual(['decom-a']);
  });

  it('cooling type multi-select', () => {
    const filters: FilterState = { ...EMPTY_FILTERS, coolingTypes: ['evap', 'liquid'] };
    const out = applyFilters(FIXTURES, filters);
    expect(out.map((x) => x.slug).sort()).toEqual(['aws-a', 'meta-a']);
  });

  it('returns empty when filters contradict (state=VA & operator=Google)', () => {
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      states: ['VA'],
      operators: ['Google'],
    };
    expect(applyFilters(FIXTURES, filters)).toEqual([]);
  });

  it('degrades gracefully on facilities missing cooling/state/year (undefined fields)', () => {
    const partial = [f({ slug: 'p1', operator: 'X', mw: 50, status: 'operational' })];
    // Filter by cooling_type — partial record has no cooling_type → should be excluded
    expect(applyFilters(partial, { ...EMPTY_FILTERS, coolingTypes: ['air'] })).toEqual([]);
    // Filter by state — same reasoning
    expect(applyFilters(partial, { ...EMPTY_FILTERS, states: ['VA'] })).toEqual([]);
    // No filter active on those dimensions — partial record passes
    expect(applyFilters(partial, EMPTY_FILTERS)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// URL serialization round-trip
// ---------------------------------------------------------------------------

describe('serializeFilters + parseFiltersFromUrl', () => {
  const facets = deriveFacetOptions(FIXTURES);

  it('EMPTY_FILTERS serializes to all-null (no params in URL)', () => {
    const patch = serializeFilters(EMPTY_FILTERS, facets);
    expect(patch).toEqual({
      o: null,
      t: null,
      s: null,
      c: null,
      st: null,
      mw: null,
      yr: null,
    });
  });

  it('round-trips operators, statuses, tenant types', () => {
    const original: FilterState = {
      ...EMPTY_FILTERS,
      operators: ['Meta', 'AWS'],
      tenantTypes: ['hyperscaler'],
      statuses: ['operational'],
    };
    const patch = serializeFilters(original, facets);
    expect(patch.o).toBe('Meta,AWS');
    expect(patch.t).toBe('hyperscaler');
    expect(patch.s).toBe('operational');

    const params = patchToUrl(patch);
    const round = parseFiltersFromUrl(params, facets);
    expect(round.operators).toEqual(['Meta', 'AWS']);
    expect(round.tenantTypes).toEqual(['hyperscaler']);
    expect(round.statuses).toEqual(['operational']);
  });

  it('drops the status param when statuses === STATUS_DEFAULT', () => {
    const patch = serializeFilters(EMPTY_FILTERS, facets);
    expect(patch.s).toBeNull();
  });

  it('drops the status param even with reordered default set', () => {
    const reordered: FilterState = {
      ...EMPTY_FILTERS,
      statuses: ['announced', 'operational', 'under_construction'],
    };
    expect(serializeFilters(reordered, facets).s).toBeNull();
  });

  it('absent s= parses to STATUS_DEFAULT', () => {
    const out = parseFiltersFromUrl(new URLSearchParams(''), facets);
    expect([...out.statuses].sort()).toEqual([...STATUS_DEFAULT].sort());
  });

  it('explicit s=operational parses to single value (not default)', () => {
    const out = parseFiltersFromUrl(new URLSearchParams('s=operational'), facets);
    expect(out.statuses).toEqual(['operational']);
  });

  it('explicit s=operational,under_construction,announced,decommissioned keeps all four', () => {
    const out = parseFiltersFromUrl(
      new URLSearchParams('s=operational,under_construction,announced,decommissioned'),
      facets
    );
    expect([...out.statuses].sort()).toEqual(
      ['announced', 'decommissioned', 'operational', 'under_construction'].sort()
    );
  });

  it('drops mw param when range equals full bounds', () => {
    const filters: FilterState = { ...EMPTY_FILTERS, mwRange: facets.mwBounds };
    expect(serializeFilters(filters, facets).mw).toBeNull();
  });

  it('serializes engaged mw range', () => {
    const filters: FilterState = { ...EMPTY_FILTERS, mwRange: [100, 500] };
    expect(serializeFilters(filters, facets).mw).toBe('100-500');
  });

  it('parses engaged mw range', () => {
    const out = parseFiltersFromUrl(new URLSearchParams('mw=100-500'), facets);
    expect(out.mwRange).toEqual([100, 500]);
  });

  it('clamps out-of-bound mw range to facet bounds', () => {
    // facets.mwBounds is [50, 800] from fixtures
    const out = parseFiltersFromUrl(new URLSearchParams('mw=0-10000'), facets);
    // Clamped to [50, 800] which equals full bounds → collapses to null
    expect(out.mwRange).toBeNull();
  });

  it('drops invalid mw values', () => {
    const out = parseFiltersFromUrl(new URLSearchParams('mw=notanumber'), facets);
    expect(out.mwRange).toBeNull();
  });

  it('drops unknown tenant type values (forward compat)', () => {
    const out = parseFiltersFromUrl(new URLSearchParams('t=hyperscaler,future_type'), facets);
    expect(out.tenantTypes).toEqual(['hyperscaler']);
  });

  it('accepts freeform operator values (URL stays user-editable)', () => {
    const out = parseFiltersFromUrl(new URLSearchParams('o=NotInOurData'), facets);
    expect(out.operators).toEqual(['NotInOurData']);
  });

  it('normalizes state codes to uppercase', () => {
    const out = parseFiltersFromUrl(new URLSearchParams('st=va,wa'), facets);
    expect(out.states).toEqual(['VA', 'WA']);
  });
});

// ---------------------------------------------------------------------------
// hasActiveFilters / activeFilterCount
// ---------------------------------------------------------------------------

describe('hasActiveFilters', () => {
  it('returns false for EMPTY_FILTERS (default state)', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('returns true when any multi-select has selections', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, operators: ['Meta'] })).toBe(true);
  });

  it('returns true when status deviates from default (decommissioned added)', () => {
    expect(
      hasActiveFilters({
        ...EMPTY_FILTERS,
        statuses: ['operational', 'under_construction', 'announced', 'decommissioned'],
      })
    ).toBe(true);
  });

  it('returns true when MW range is engaged', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, mwRange: [100, 200] })).toBe(true);
  });
});

describe('activeFilterCount', () => {
  it('counts each active dimension once', () => {
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      operators: ['Meta'],
      tenantTypes: ['hyperscaler'],
      mwRange: [100, 500],
    };
    expect(activeFilterCount(filters)).toBe(3);
  });

  it('is zero for the default state', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patchToUrl(patch: Record<string, string | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null) p.set(k, v);
  }
  return p;
}
