#!/usr/bin/env tsx
/**
 * ingest.ts — YAML → Postgres ingest script for usdatacenterwatch.
 *
 * Usage:
 *   pnpm ingest
 *   DATABASE_URL="postgres://..." pnpm ingest
 *
 * What it does:
 *   1. Reads every data/facilities/{state}/{slug}.yaml file
 *   2. Validates each with the Zod schema (mirrors src/db/schema.ts)
 *   3. Reports validation errors with file:field context
 *   4. Upserts valid facilities into Neon (ON CONFLICT slug DO UPDATE)
 *   5. Appends a new estimate row for each facility (audit-friendly)
 *   6. Exits non-zero if any validation fails
 *
 * Idempotent: running twice leaves facilities with one row each,
 * and estimates with two rows each (append-only audit trail).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYamlFiles } from './ingest/yaml-loader.js';
import { validateFacilities, reportFailures } from './ingest/validate.js';
import { computeEstimates } from './ingest/estimates.js';
import { createPgClient, upsertFacility, insertEstimate } from './ingest/upsert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const facilitiesDir = join(projectRoot, 'data', 'facilities');

async function main() {
  // --- Environment ---
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL env var is required.');
    process.exit(1);
  }

  // --- Load YAML files ---
  console.log(`Loading YAML files from ${facilitiesDir} …`);
  let files;
  try {
    files = loadYamlFiles(facilitiesDir, projectRoot);
  } catch (err) {
    console.error('Fatal: failed to load YAML files:', err);
    process.exit(1);
  }
  console.log(`  Found ${files.length} file(s).`);

  if (files.length === 0) {
    console.log('Nothing to ingest — no YAML files found.');
    process.exit(0);
  }

  // --- Validate ---
  console.log('\nValidating …');
  const { valid, failures } = validateFacilities(files);
  const failCount = reportFailures(failures);

  console.log(`  Valid:  ${valid.length}`);
  console.log(`  Failed: ${failCount}`);

  if (failCount > 0) {
    console.error('\nIngest aborted due to validation errors. Fix the issues above and re-run.');
    process.exit(1);
  }

  if (valid.length === 0) {
    console.log('No valid facilities to ingest.');
    process.exit(0);
  }

  // --- Connect to DB ---
  const client = createPgClient(connectionString);
  try {
    await client.connect();
    console.log('\nConnected to database.');

    let upserted = 0;
    let estimated = 0;
    let skippedEstimate = 0;

    for (const { relativePath, data } of valid) {
      // Upsert facility
      const facilityId = await upsertFacility(client, data);
      upserted++;
      console.log(`  upserted  ${data.slug}  (id: ${facilityId})`);

      // Compute and insert estimate
      const estimate = computeEstimates(data);
      if (estimate) {
        await insertEstimate(client, facilityId, estimate);
        estimated++;
        console.log(
          `  estimated ${data.slug}  ` +
            `${estimate.estimated_annual_gwh.toFixed(1)} GWh/yr, ` +
            `${(estimate.estimated_annual_gallons / 1_000_000).toFixed(1)} M gal/yr`
        );
      } else {
        skippedEstimate++;
        console.log(`  no estimate for ${data.slug} — it_load_mw is missing (${relativePath})`);
      }
    }

    console.log(`\nDone.`);
    console.log(`  Facilities upserted: ${upserted}`);
    console.log(`  Estimates inserted:  ${estimated}`);
    if (skippedEstimate > 0) {
      console.log(`  Estimates skipped (no it_load_mw): ${skippedEstimate}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
