/**
 * ingest.test.ts — unit tests for the USD-8 ingest pipeline.
 *
 * Coverage:
 *  1. Zod validation: happy path, 3 failure modes
 *  2. Estimates math: one known input → expected output ±0.1%
 *  3. Upsert SQL integration: tested against a real Neon dev branch (see
 *     the Neon branch verification section in the PR body for that output).
 *     Here we test the pure logic only (no live DB connection needed for CI).
 */

import { describe, it, expect } from 'vitest';
import { FacilityYamlSchema } from '@/lib/zod-facility-schema.js';
import {
  computeEstimates,
  DEFAULT_PUE,
  DEFAULT_WUE,
  DEFAULT_UTILIZATION,
  DEFAULT_CLIMATE_FACTOR,
  L_PER_KWH_TO_GAL,
  METHODOLOGY_VERSION,
  UNCERTAINTY,
} from './ingest/estimates.js';
import { validateFacilities } from './ingest/validate.js';
import type { FacilityYaml } from '@/lib/zod-facility-schema.js';

// ---------------------------------------------------------------------------
// Minimal valid facility fixture
// ---------------------------------------------------------------------------

const VALID_FACILITY: FacilityYaml = {
  slug: 'test-facility-or',
  name: 'Test Facility',
  operator: 'TestCorp',
  tenant_type: 'hyperscaler',
  status: 'operational',
  location: { lng: -120.0, lat: 44.0 },
  confidence: 'high',
  sources: [{ url: 'https://example.com', accessed_at: '2026-01-01', supports: ['operator'] }],
};

// ---------------------------------------------------------------------------
// 1. Zod schema: happy path
// ---------------------------------------------------------------------------

describe('FacilityYamlSchema — happy path', () => {
  it('accepts a minimal valid facility', () => {
    const result = FacilityYamlSchema.safeParse(VALID_FACILITY);
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated facility', () => {
    const full: FacilityYaml = {
      ...VALID_FACILITY,
      tenant_type: 'colo',
      tenants: ['AWS', 'Microsoft'],
      address: '123 Main St',
      city: 'Portland',
      county: 'Multnomah',
      state: 'OR',
      fips: '41051',
      acres: 50,
      sqft: 500000,
      year_built: 2018,
      it_load_mw: 100,
      total_mw: 150,
      design_pue: 1.4,
      cooling_type: 'air',
      reported_wue: 0.1,
      power_sources: { grid: 0.7, solar: 0.3 },
      water_source: 'municipal',
      construction_capex_usd: 500_000_000,
      jobs_construction: 800,
      jobs_permanent: 150,
      subsidies: [
        {
          program: 'Oregon Enterprise Zone',
          year: 2018,
          value_usd: 10_000_000,
          source_url: 'https://example.com/subsidy',
        },
      ],
      last_verified: '2026-05-01',
    };
    const result = FacilityYamlSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('accepts nullable optional fields', () => {
    const withNulls = { ...VALID_FACILITY, it_load_mw: null, design_pue: null, acres: null };
    const result = FacilityYamlSchema.safeParse(withNulls);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Zod schema: failure modes
// ---------------------------------------------------------------------------

describe('FacilityYamlSchema — failure modes', () => {
  it('rejects a facility with no sources', () => {
    const bad = { ...VALID_FACILITY, sources: [] };
    const result = FacilityYamlSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod v4 uses .issues
      const paths = result.error.issues.map((e) => e.path.join('.'));
      expect(paths).toContain('sources');
    }
  });

  it('rejects an unknown top-level key (strict mode)', () => {
    const bad = { ...VALID_FACILITY, typo_field: 'oops' };
    const result = FacilityYamlSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((e) => e.message);
      expect(
        messages.some((m) => m.includes('typo_field') || m.toLowerCase().includes('unrecognized'))
      ).toBe(true);
    }
  });

  it('rejects an invalid tenant_type', () => {
    const bad = { ...VALID_FACILITY, tenant_type: 'not-a-type' };
    const result = FacilityYamlSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((e) => e.path.join('.'));
      expect(paths).toContain('tenant_type');
    }
  });

  it('rejects power_sources that do not sum to 1.0', () => {
    const bad = {
      ...VALID_FACILITY,
      power_sources: { grid: 0.5, solar: 0.3 }, // sums to 0.8
    };
    const result = FacilityYamlSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('sum'))).toBe(true);
    }
  });

  it('rejects a missing required field (slug)', () => {
    const { slug: _slug, ...bad } = VALID_FACILITY;
    void _slug; // destructured only to omit from 'bad'
    const result = FacilityYamlSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((e) => e.path.join('.'));
      expect(paths).toContain('slug');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Estimates math
// ---------------------------------------------------------------------------

describe('computeEstimates — math', () => {
  it('returns null when it_load_mw is missing', () => {
    expect(computeEstimates({ ...VALID_FACILITY, it_load_mw: undefined })).toBeNull();
    expect(computeEstimates({ ...VALID_FACILITY, it_load_mw: null })).toBeNull();
  });

  it('computes known Meta Prineville values within ±0.1%', () => {
    // Meta Prineville: 250 MW IT load, design_pue=1.10, evap cooling, high confidence
    const facility: FacilityYaml = {
      ...VALID_FACILITY,
      it_load_mw: 250,
      design_pue: 1.1,
      cooling_type: 'evap',
      confidence: 'high',
    };

    const result = computeEstimates(facility);
    expect(result).not.toBeNull();
    if (!result) return;

    // Expected:
    // kWh = 250 * 1000 * 0.6 * 1.10 * 8760 = 1_448_280_000 kWh/yr
    // GWh = 1448.28 GWh/yr
    const expectedKwh = 250 * 1000 * DEFAULT_UTILIZATION * 1.1 * 8760;
    const expectedGwh = expectedKwh / 1_000_000;
    expect(result.estimated_annual_gwh).toBeCloseTo(expectedGwh, 1);
    expect(result.estimated_annual_gwh_low).toBeCloseTo(expectedGwh * (1 - UNCERTAINTY.high), 1);
    expect(result.estimated_annual_gwh_high).toBeCloseTo(expectedGwh * (1 + UNCERTAINTY.high), 1);

    // Expected gallons:
    // wue for evap = 1.8 L/kWh (since no reported_wue)
    // gal = 1448280000 * 1.8 * 1.0 * 0.264172 ≈ 688_553_520 gal
    const expectedWue = DEFAULT_WUE['evap'];
    const expectedGal = expectedKwh * expectedWue * DEFAULT_CLIMATE_FACTOR * L_PER_KWH_TO_GAL;
    const tolerance = expectedGal * 0.001; // ±0.1%
    expect(Math.abs(result.estimated_annual_gallons - expectedGal)).toBeLessThan(tolerance);

    // Inputs audit record
    expect(result.inputs.pue_source).toBe('reported');
    expect(result.inputs.wue_source).toBe('default_by_cooling');
    expect(result.inputs.methodology_version).toBe(METHODOLOGY_VERSION);
    expect(result.inputs.utilization).toBe(DEFAULT_UTILIZATION);
    expect(result.inputs.climate_factor).toBe(DEFAULT_CLIMATE_FACTOR);
  });

  it('falls back to default PUE when design_pue is absent', () => {
    const facility: FacilityYaml = {
      ...VALID_FACILITY,
      tenant_type: 'colo',
      it_load_mw: 10,
      cooling_type: 'air',
    };
    const result = computeEstimates(facility);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.inputs.pue).toBe(DEFAULT_PUE['colo']);
    expect(result.inputs.pue_source).toBe('default_by_tenant_type');
  });

  it('uses reported_wue when present', () => {
    const facility: FacilityYaml = {
      ...VALID_FACILITY,
      it_load_mw: 100,
      reported_wue: 0.5,
      cooling_type: 'liquid', // would give 0.2 by default
    };
    const result = computeEstimates(facility);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.inputs.wue).toBe(0.5);
    expect(result.inputs.wue_source).toBe('reported');
  });

  it('applies low confidence uncertainty (±50%)', () => {
    const facility: FacilityYaml = {
      ...VALID_FACILITY,
      confidence: 'low',
      it_load_mw: 50,
    };
    const result = computeEstimates(facility);
    expect(result).not.toBeNull();
    if (!result) return;
    const center = result.estimated_annual_gwh;
    expect(result.estimated_annual_gwh_low).toBeCloseTo(center * 0.5, 1);
    expect(result.estimated_annual_gwh_high).toBeCloseTo(center * 1.5, 1);
  });
});

// ---------------------------------------------------------------------------
// 4. validateFacilities wrapper
// ---------------------------------------------------------------------------

describe('validateFacilities', () => {
  it('returns valid entries for well-formed YAML objects', () => {
    const files = [
      {
        filePath: '/fake/path/test.yaml',
        relativePath: 'data/facilities/or/test.yaml',
        raw: VALID_FACILITY,
      },
    ];
    const { valid, failures } = validateFacilities(files);
    expect(valid).toHaveLength(1);
    expect(failures).toHaveLength(0);
    expect(valid[0]?.data.slug).toBe('test-facility-or');
  });

  it('returns failures for invalid YAML objects', () => {
    const files = [
      {
        filePath: '/fake/path/bad.yaml',
        relativePath: 'data/facilities/or/bad.yaml',
        raw: { slug: 'no-required-fields' }, // missing many required fields
      },
    ];
    const { valid, failures } = validateFacilities(files);
    expect(valid).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.errors.length).toBeGreaterThan(0);
  });

  it('collects errors from all files (does not stop at first failure)', () => {
    const files = [
      {
        filePath: '/a.yaml',
        relativePath: 'a.yaml',
        raw: { slug: 'bad-a' },
      },
      {
        filePath: '/b.yaml',
        relativePath: 'b.yaml',
        raw: { slug: 'bad-b' },
      },
    ];
    const { valid, failures } = validateFacilities(files);
    expect(valid).toHaveLength(0);
    expect(failures).toHaveLength(2);
  });
});
