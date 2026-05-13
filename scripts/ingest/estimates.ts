/**
 * estimates.ts — tiered power and water modeling for a facility.
 *
 * Methodology version: 2026-05-v1
 *
 * Formula:
 *   kWh  = it_load_mw × 1000 × utilization × pue × 8760
 *   gal  = kWh × wue × climate_factor × L_PER_KWH_TO_GAL
 *
 * Constants are all defined at module scope so callers can inspect them.
 * This module is a pure function — no DB or I/O.
 */

import type { FacilityYaml } from '@/lib/zod-facility-schema.js';

// ---------------------------------------------------------------------------
// Public constants (inspectable, methodology-version-stamped)
// ---------------------------------------------------------------------------

export const METHODOLOGY_VERSION = '2026-05-v1';

/** L/kWh → US gallons conversion factor */
export const L_PER_KWH_TO_GAL = 0.264172;

/** Default server utilization (fraction of peak IT load) */
export const DEFAULT_UTILIZATION = 0.6;

/** Default PUE by tenant_type when design_pue is not reported */
export const DEFAULT_PUE: Record<FacilityYaml['tenant_type'], number> = {
  hyperscaler: 1.15,
  colo: 1.45,
  crypto: 1.05,
  enterprise: 1.55,
};

/** Default WUE (L/kWh) by cooling_type when reported_wue is not available */
export const DEFAULT_WUE: Record<NonNullable<FacilityYaml['cooling_type']>, number> = {
  air: 0.1,
  evap: 1.8,
  liquid: 0.2,
  hybrid: 1.0,
};

/**
 * Climate factor for evaporative WUE adjustment.
 *
 * TODO (follow-up): Integrate NOAA/PRISM 30-year climate normals at the
 * facility's location. Evap WUE scales roughly with annual wet-bulb
 * temperature: higher wet-bulb → more evaporation needed per kWh cooled.
 * The integration should:
 *   1. Accept lat/lng for the facility.
 *   2. Query PRISM API (https://prism.oregonstate.edu/) for annual mean
 *      wet-bulb at that point.
 *   3. Derive a multiplier relative to the 1.0 baseline (e.g., Phoenix desert
 *      heat → ~1.3, Pacific Northwest mild climate → ~0.7).
 * For v1 we default to 1.0 (no climate adjustment).
 */
export const DEFAULT_CLIMATE_FACTOR = 1.0;

/** Uncertainty half-width by confidence level (fraction of central estimate) */
export const UNCERTAINTY: Record<FacilityYaml['confidence'], number> = {
  high: 0.2,
  medium: 0.5,
  low: 0.5,
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** The full inputs record written to facility_estimates.inputs (JSONB) */
export interface EstimateInputs {
  methodology_version: string;
  pue: number;
  pue_source: 'reported' | 'default_by_tenant_type';
  wue: number;
  wue_source: 'reported' | 'default_by_cooling' | 'default_air_fallback';
  utilization: number;
  climate_factor: number;
  it_load_mw: number;
}

export interface FacilityEstimateResult {
  /** Central estimate in GWh/year */
  estimated_annual_gwh: number;
  estimated_annual_gwh_low: number;
  estimated_annual_gwh_high: number;
  /** Central estimate in US gallons/year */
  estimated_annual_gallons: number;
  estimated_annual_gallons_low: number;
  estimated_annual_gallons_high: number;
  /** Full audit record of what was used */
  inputs: EstimateInputs;
}

// ---------------------------------------------------------------------------
// Core computation (pure function — deterministic, no I/O)
// ---------------------------------------------------------------------------

/**
 * Computes annual energy and water estimates for a facility.
 *
 * Returns null if it_load_mw is absent (we can't estimate without a load figure).
 */
export function computeEstimates(facility: FacilityYaml): FacilityEstimateResult | null {
  const itLoadMw = facility.it_load_mw;
  if (itLoadMw == null) return null;

  // --- PUE ---
  let pue: number;
  let pue_source: EstimateInputs['pue_source'];
  if (facility.design_pue != null) {
    pue = facility.design_pue;
    pue_source = 'reported';
  } else {
    pue = DEFAULT_PUE[facility.tenant_type];
    pue_source = 'default_by_tenant_type';
  }

  // --- WUE ---
  let wue: number;
  let wue_source: EstimateInputs['wue_source'];
  if (facility.reported_wue != null) {
    wue = facility.reported_wue;
    wue_source = 'reported';
  } else if (facility.cooling_type != null) {
    wue = DEFAULT_WUE[facility.cooling_type];
    wue_source = 'default_by_cooling';
  } else {
    // No cooling type disclosed — fall back to air (the lowest-water assumption).
    // Logged as `default_air_fallback` so the audit trail records both the
    // fallback choice and that no cooling type was disclosed.
    wue = DEFAULT_WUE['air'];
    wue_source = 'default_air_fallback';
  }

  const utilization = DEFAULT_UTILIZATION;
  const climate_factor = DEFAULT_CLIMATE_FACTOR;

  // --- Energy ---
  const kwhPerYear = itLoadMw * 1000 * utilization * pue * 8760;
  const gwhPerYear = kwhPerYear / 1_000_000;

  // --- Water ---
  const gallonsPerYear = kwhPerYear * wue * climate_factor * L_PER_KWH_TO_GAL;

  // --- Uncertainty ---
  const halfWidth = UNCERTAINTY[facility.confidence];

  const inputs: EstimateInputs = {
    methodology_version: METHODOLOGY_VERSION,
    pue,
    pue_source,
    wue,
    wue_source,
    utilization,
    climate_factor,
    it_load_mw: itLoadMw,
  };

  return {
    estimated_annual_gwh: round(gwhPerYear, 4),
    estimated_annual_gwh_low: round(gwhPerYear * (1 - halfWidth), 4),
    estimated_annual_gwh_high: round(gwhPerYear * (1 + halfWidth), 4),
    estimated_annual_gallons: round(gallonsPerYear, 0),
    estimated_annual_gallons_low: round(gallonsPerYear * (1 - halfWidth), 0),
    estimated_annual_gallons_high: round(gallonsPerYear * (1 + halfWidth), 0),
    inputs,
  };
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
