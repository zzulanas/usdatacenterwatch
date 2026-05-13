#!/usr/bin/env tsx
/**
 * validate-model.ts — calibrate the estimates model against operator
 * disclosures.
 *
 * USD-12: for every facility with a `reported_annual_mwh` field set, compute
 * the modeled `annual_gwh` from `estimates.ts` and compare. The model
 * is calibrated when modeled ≈ reported within VARIANCE_THRESHOLD.
 *
 * Usage:
 *   pnpm validate-model              # print table, exit 0 if all within threshold
 *   pnpm validate-model --strict     # exit non-zero if any facility drifts
 *
 * Reads YAML files directly. No DB, no network. Designed to run in CI as a
 * cheap gate against modeling regressions.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYamlFiles } from './ingest/yaml-loader.js';
import { validateFacilities } from './ingest/validate.js';
import { computeEstimates } from './ingest/estimates.js';
import type { FacilityYaml } from '@/lib/zod-facility-schema.js';
import type { FacilityEstimateResult } from './ingest/estimates.js';

/**
 * Allowed absolute variance between modeled annual GWh and operator-disclosed
 * annual MWh, expressed as a fraction. 5% is comfortably above the round-trip
 * rounding error (typically <0.5%) while still flagging real drift from any
 * change to DEFAULT_PUE / DEFAULT_UTILIZATION constants in estimates.ts.
 */
export const VARIANCE_THRESHOLD = 0.05;

export interface CalibrationRow {
  slug: string;
  reportedAnnualMwh: number;
  modeledAnnualMwh: number;
  variancePct: number;
  withinThreshold: boolean;
}

/**
 * Pure function: compute a calibration table from validated facilities.
 * Exported for use in the methodology page and the vitest test.
 */
export function buildCalibrationTable(facilities: FacilityYaml[]): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  for (const f of facilities) {
    if (f.reported_annual_mwh == null) continue;
    const estimate: FacilityEstimateResult | null = computeEstimates(f);
    if (estimate == null) continue;
    const modeledAnnualMwh = estimate.estimated_annual_gwh * 1000;
    const variance = (modeledAnnualMwh - f.reported_annual_mwh) / f.reported_annual_mwh;
    rows.push({
      slug: f.slug,
      reportedAnnualMwh: f.reported_annual_mwh,
      modeledAnnualMwh,
      variancePct: variance,
      withinThreshold: Math.abs(variance) <= VARIANCE_THRESHOLD,
    });
  }
  return rows;
}

function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTable(rows: CalibrationRow[]): string {
  if (rows.length === 0) return '(no facilities with reported_annual_mwh)';
  const header = ['slug', 'reported MWh', 'modeled MWh', 'variance', 'status'];
  const data = rows.map((r) => [
    r.slug,
    formatNumber(r.reportedAnnualMwh),
    formatNumber(Math.round(r.modeledAnnualMwh)),
    `${(r.variancePct * 100).toFixed(2)}%`,
    r.withinThreshold ? 'PASS' : 'DRIFT',
  ]);
  const allRows = [header, ...data];
  const widths = header.map((_, i) => Math.max(...allRows.map((r) => r[i]!.length)));
  return allRows.map((r) => r.map((c, i) => c.padEnd(widths[i]!)).join('  ')).join('\n');
}

async function main() {
  const strict = process.argv.includes('--strict');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(__dirname, '..');
  const facilitiesDir = join(projectRoot, 'data', 'facilities');

  const files = loadYamlFiles(facilitiesDir, projectRoot);
  const { valid, failures } = validateFacilities(files);
  if (failures.length > 0) {
    console.error(`${failures.length} YAML file(s) failed validation — fix those first.`);
    process.exit(2);
  }

  const rows = buildCalibrationTable(valid.map((v) => v.data));
  console.log(formatTable(rows));
  console.log('');
  const drifts = rows.filter((r) => !r.withinThreshold);
  console.log(
    `${rows.length} facility/facilities calibrated against operator disclosures;` +
      ` ${drifts.length} outside ±${VARIANCE_THRESHOLD * 100}% threshold.`
  );

  if (drifts.length > 0 && strict) {
    console.error(`Model drift detected — fail in --strict mode.`);
    process.exit(1);
  }
}

// Only run when invoked directly, not when imported (vitest imports buildCalibrationTable)
const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error('validate-model failed:', err);
    process.exit(1);
  });
}
