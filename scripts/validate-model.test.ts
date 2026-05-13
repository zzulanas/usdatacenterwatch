/**
 * validate-model.test.ts — gates model variance against operator disclosures.
 *
 * USD-12 calibration test. For every facility that carries
 * `reported_annual_mwh`, the model's output must match within
 * VARIANCE_THRESHOLD. A failure here means someone changed DEFAULT_PUE /
 * DEFAULT_UTILIZATION / 8760 / one of the YAML inputs in a way that breaks
 * the round-trip property — surface it loudly in CI before the methodology
 * page silently lies to a reader.
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYamlFiles } from './ingest/yaml-loader.js';
import { validateFacilities } from './ingest/validate.js';
import { buildCalibrationTable, VARIANCE_THRESHOLD } from './validate-model.js';

describe('USD-12 model calibration', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(__dirname, '..');
  const files = loadYamlFiles(join(projectRoot, 'data', 'facilities'), projectRoot);
  const { valid } = validateFacilities(files);
  const facilities = valid.map((v) => v.data);
  const rows = buildCalibrationTable(facilities);

  it('has at least one facility with a reported_annual_mwh disclosure', () => {
    // Sanity check — if this drops to zero we've lost the calibration
    // anchors and the gate below silently becomes a no-op.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every modeled annual MWh is within ±5% of its operator disclosure', () => {
    const drifts = rows.filter((r) => !r.withinThreshold);
    if (drifts.length > 0) {
      const detail = drifts
        .map(
          (r) =>
            `  ${r.slug}: reported=${r.reportedAnnualMwh.toLocaleString()} ` +
            `modeled=${Math.round(r.modeledAnnualMwh).toLocaleString()} ` +
            `variance=${(r.variance * 100).toFixed(2)}%`
        )
        .join('\n');
      throw new Error(
        `${drifts.length} facility/facilities exceed the ±${VARIANCE_THRESHOLD * 100}% ` +
          `model-vs-disclosure threshold:\n${detail}\n\n` +
          `Either fix the model defaults in scripts/ingest/estimates.ts, ` +
          `update the it_load_mw / design_pue in the YAML to match the new ` +
          `defaults, or — if the disclosure itself moved — update the ` +
          `reported_annual_mwh field with the new figure (and cite the source).`
      );
    }
  });
});
