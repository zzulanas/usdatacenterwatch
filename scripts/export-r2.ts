#!/usr/bin/env tsx
/**
 * export-r2.ts — Neon → R2 static dataset exporter.
 *
 * Usage:
 *   pnpm export-r2
 *   DATABASE_URL="postgres://..." CLOUDFLARE_API_TOKEN="..." pnpm export-r2
 *
 * What it does:
 *   1. Queries Neon for all facilities + their latest estimates (LATERAL JOIN)
 *   2. Shapes the data into the canonical dataset JSON format
 *   3. Gzips the JSON
 *   4. Computes a SHA-256 hash over the gzipped bytes
 *   5. Uploads facilities-{hash}.json.gz to R2 (Content-Encoding: gzip)
 *   6. Uploads manifest.json pointing at the just-uploaded facilities file
 *   7. Prints a summary: hash, byte sizes, facility + estimate counts
 *
 * Required env vars:
 *   DATABASE_URL          — Neon Postgres connection string
 *   CLOUDFLARE_API_TOKEN  — Cloudflare API token with R2 write access
 *   CLOUDFLARE_ACCOUNT_ID — Cloudflare account ID
 *   R2_BUCKET_NAME        — R2 bucket name (default: usdatacenterwatch)
 *
 * PMTiles: deferred to M2. Once the Protomaps US extract is downloaded and
 * hosted, add a companion step here to upload the .pmtiles file and add its
 * URL to the manifest. See Linear USD-TODO (follow-up ticket).
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';

const { Client } = pg;

// ---------------------------------------------------------------------------
// Methodology version (keep in sync with scripts/ingest/estimates.ts)
// ---------------------------------------------------------------------------
const METHODOLOGY_VERSION = '2026-05-v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FacilityRow {
  slug: string;
  name: string;
  operator: string;
  tenant_type: string;
  status: string;
  lng: number;
  lat: number;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  fips: string | null;
  acres: string | null;
  sqft: string | null;
  year_built: number | null;
  it_load_mw: string | null;
  total_mw: string | null;
  design_pue: string | null;
  cooling_type: string | null;
  reported_wue: string | null;
  water_source: string | null;
  construction_capex_usd: string | null;
  jobs_construction: number | null;
  jobs_permanent: number | null;
  subsidies: unknown | null;
  sources: unknown;
  confidence: string;
  last_verified: Date | null;
  // Latest estimate (null if no estimate exists)
  est_methodology_version: string | null;
  est_annual_gwh: string | null;
  est_annual_gwh_low: string | null;
  est_annual_gwh_high: string | null;
  est_annual_gallons: string | null;
  est_annual_gallons_low: string | null;
  est_annual_gallons_high: string | null;
  est_inputs: unknown | null;
  est_computed_at: Date | null;
}

interface FacilityDataset {
  slug: string;
  name: string;
  operator: string;
  tenant_type: string;
  status: string;
  location: { lng: number; lat: number };
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  fips: string | null;
  acres: number | null;
  sqft: number | null;
  year_built: number | null;
  it_load_mw: number | null;
  total_mw: number | null;
  design_pue: number | null;
  cooling_type: string | null;
  reported_wue: number | null;
  water_source: string | null;
  construction_capex_usd: number | null;
  jobs_construction: number | null;
  jobs_permanent: number | null;
  subsidies: unknown | null;
  sources: unknown;
  confidence: string;
  last_verified: string | null;
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
}

interface ExportDocument {
  version: '1';
  generated_at: string;
  methodology_version: string;
  facilities: FacilityDataset[];
}

interface Manifest {
  version: '1';
  generated_at: string;
  facilities_url: string;
  facility_count: number;
  methodology_version: string;
}

// ---------------------------------------------------------------------------
// Database query
// ---------------------------------------------------------------------------

async function queryFacilities(client: pg.Client): Promise<FacilityRow[]> {
  // LATERAL JOIN picks the single most-recent estimate row per facility.
  // If a facility has no estimates yet, the LEFT JOIN returns NULLs for
  // the estimate columns (handled in shaping below).
  const result = await client.query<FacilityRow>(`
    SELECT
      f.slug,
      f.name,
      f.operator,
      f.tenant_type,
      f.status,
      ST_X(f.location::geometry)  AS lng,
      ST_Y(f.location::geometry)  AS lat,
      f.address,
      f.city,
      f.county,
      f.state,
      f.fips,
      f.acres,
      f.sqft,
      f.year_built,
      f.it_load_mw,
      f.total_mw,
      f.design_pue,
      f.cooling_type,
      f.reported_wue,
      f.water_source,
      f.construction_capex_usd,
      f.jobs_construction,
      f.jobs_permanent,
      f.subsidies,
      f.sources,
      f.confidence,
      f.last_verified,
      e.methodology_version   AS est_methodology_version,
      e.estimated_annual_gwh  AS est_annual_gwh,
      e.estimated_annual_gwh_low   AS est_annual_gwh_low,
      e.estimated_annual_gwh_high  AS est_annual_gwh_high,
      e.estimated_annual_gallons       AS est_annual_gallons,
      e.estimated_annual_gallons_low   AS est_annual_gallons_low,
      e.estimated_annual_gallons_high  AS est_annual_gallons_high,
      e.inputs       AS est_inputs,
      e.computed_at  AS est_computed_at
    FROM facilities f
    LEFT JOIN LATERAL (
      SELECT *
      FROM facility_estimates fe
      WHERE fe.facility_id = f.id
      ORDER BY fe.computed_at DESC
      LIMIT 1
    ) e ON true
    ORDER BY f.slug
  `);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Data shaping
// ---------------------------------------------------------------------------

function numericOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function shapeFacilities(rows: FacilityRow[]): FacilityDataset[] {
  return rows.map((row) => {
    const estimate =
      row.est_annual_gwh != null
        ? {
            methodology_version: row.est_methodology_version ?? METHODOLOGY_VERSION,
            annual_gwh: numericOrNull(row.est_annual_gwh) ?? 0,
            annual_gwh_low: numericOrNull(row.est_annual_gwh_low) ?? 0,
            annual_gwh_high: numericOrNull(row.est_annual_gwh_high) ?? 0,
            annual_gallons: numericOrNull(row.est_annual_gallons) ?? 0,
            annual_gallons_low: numericOrNull(row.est_annual_gallons_low) ?? 0,
            annual_gallons_high: numericOrNull(row.est_annual_gallons_high) ?? 0,
            inputs: row.est_inputs,
            computed_at: row.est_computed_at?.toISOString() ?? new Date().toISOString(),
          }
        : null;

    return {
      slug: row.slug,
      name: row.name,
      operator: row.operator,
      tenant_type: row.tenant_type,
      status: row.status,
      location: { lng: Number(row.lng), lat: Number(row.lat) },
      address: row.address,
      city: row.city,
      county: row.county,
      state: row.state,
      fips: row.fips,
      acres: numericOrNull(row.acres),
      sqft: numericOrNull(row.sqft),
      year_built: row.year_built,
      it_load_mw: numericOrNull(row.it_load_mw),
      total_mw: numericOrNull(row.total_mw),
      design_pue: numericOrNull(row.design_pue),
      cooling_type: row.cooling_type,
      reported_wue: numericOrNull(row.reported_wue),
      water_source: row.water_source,
      construction_capex_usd: numericOrNull(row.construction_capex_usd),
      jobs_construction: row.jobs_construction,
      jobs_permanent: row.jobs_permanent,
      subsidies: row.subsidies,
      sources: row.sources,
      confidence: row.confidence,
      last_verified: row.last_verified?.toISOString().split('T')[0] ?? null,
      estimate,
    };
  });
}

// ---------------------------------------------------------------------------
// R2 upload via wrangler CLI
// ---------------------------------------------------------------------------

function uploadToR2(
  bucketName: string,
  objectKey: string,
  localPath: string,
  contentType: string,
  contentEncoding?: string
): void {
  const args = [
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucketName}/${objectKey}`,
    '--file',
    localPath,
    '--content-type',
    contentType,
  ];

  if (contentEncoding) {
    args.push('--content-encoding', contentEncoding);
  }

  // wrangler reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from env
  execFileSync('npx', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- Environment validation ---
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL env var is required.');
    process.exit(1);
  }
  const cfToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!cfToken) {
    console.error('ERROR: CLOUDFLARE_API_TOKEN env var is required.');
    process.exit(1);
  }
  const cfAccount = process.env['CLOUDFLARE_ACCOUNT_ID'];
  if (!cfAccount) {
    console.error('ERROR: CLOUDFLARE_ACCOUNT_ID env var is required.');
    process.exit(1);
  }
  const bucketName = process.env['R2_BUCKET_NAME'] ?? 'usdatacenterwatch';

  // --- Connect to DB ---
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log('Connected to database.');

  let rows: FacilityRow[];
  try {
    rows = await queryFacilities(client);
  } finally {
    await client.end();
  }

  console.log(`  Fetched ${rows.length} facility row(s).`);
  const estimateCount = rows.filter((r) => r.est_annual_gwh != null).length;
  console.log(`  With estimates: ${estimateCount}`);

  // --- Shape into export document ---
  const generatedAt = new Date().toISOString();
  const facilities = shapeFacilities(rows);

  const document: ExportDocument = {
    version: '1',
    generated_at: generatedAt,
    methodology_version: METHODOLOGY_VERSION,
    facilities,
  };

  // No indent for production (smaller payload); easy to pretty-print locally
  // with `gunzip | jq '.'` when debugging.
  const jsonBytes = Buffer.from(JSON.stringify(document), 'utf-8');
  console.log(`\nJSON size (uncompressed): ${jsonBytes.byteLength.toLocaleString()} bytes`);

  // --- Gzip ---
  const gzipped = gzipSync(jsonBytes, { level: 9 });
  console.log(`Gzip size (compressed):   ${gzipped.byteLength.toLocaleString()} bytes`);
  const ratio = ((1 - gzipped.byteLength / jsonBytes.byteLength) * 100).toFixed(1);
  console.log(`Compression ratio:        ${ratio}%`);

  // --- Hash ---
  const hash = createHash('sha256').update(gzipped).digest('hex').slice(0, 16);
  console.log(`\nSHA-256 (first 16 hex):   ${hash}`);

  const facilitiesKey = `facilities-${hash}.json.gz`;

  // --- Write to temp files ---
  const tmpFacilitiesPath = join(tmpdir(), facilitiesKey);
  const tmpManifestPath = join(tmpdir(), 'manifest.json');

  try {
    writeFileSync(tmpFacilitiesPath, gzipped);

    const manifest: Manifest = {
      version: '1',
      generated_at: generatedAt,
      facilities_url: facilitiesKey,
      facility_count: facilities.length,
      methodology_version: METHODOLOGY_VERSION,
    };
    writeFileSync(tmpManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // --- Upload facilities file ---
    console.log(`\nUploading ${facilitiesKey} to R2 bucket "${bucketName}" …`);
    uploadToR2(bucketName, facilitiesKey, tmpFacilitiesPath, 'application/json', 'gzip');
    console.log(`  ✓ Uploaded ${facilitiesKey}`);

    // --- Upload manifest ---
    console.log('Uploading manifest.json …');
    uploadToR2(bucketName, 'manifest.json', tmpManifestPath, 'application/json');
    console.log('  ✓ Uploaded manifest.json');
  } finally {
    // Clean up temp files
    try {
      unlinkSync(tmpFacilitiesPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(tmpManifestPath);
    } catch {
      // ignore
    }
  }

  // --- Summary ---
  console.log('\n--- Export summary ---');
  console.log(`  Facilities exported: ${facilities.length}`);
  console.log(`  Estimates included:  ${estimateCount}`);
  console.log(`  Dataset key:         ${facilitiesKey}`);
  console.log(`  JSON (raw):          ${jsonBytes.byteLength.toLocaleString()} bytes`);
  console.log(`  Gzip (uploaded):     ${gzipped.byteLength.toLocaleString()} bytes`);
  console.log(`  Manifest:            manifest.json`);
  console.log(`  Generated at:        ${generatedAt}`);
}

main().catch((err) => {
  console.error('export-r2 failed:', err);
  process.exit(1);
});
