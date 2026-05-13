/**
 * upsert.ts — persists validated facility data and estimates to Neon.
 *
 * Uses the `pg` client directly (not the Neon HTTP driver / Drizzle ORM)
 * because the ingest script is a Node.js CLI and `pg` supports standard
 * PostgreSQL protocol with proper connection pooling and multi-statement
 * transactions. The HTTP driver is reserved for edge runtime (Astro endpoints).
 *
 * Idempotency contract:
 *  - facilities: ON CONFLICT (slug) DO UPDATE — updates all mutable fields
 *  - facility_estimates: always INSERT (append-only, for audit trail)
 *    Running twice → 1 facility row, 2 estimate rows
 */

import pg from 'pg';
import type { FacilityYaml } from '@/lib/zod-facility-schema.js';
import type { FacilityEstimateResult } from './estimates.js';

const { Client } = pg;

// ---------------------------------------------------------------------------
// Facility upsert
// ---------------------------------------------------------------------------

/**
 * Upserts a facility record by slug.
 * Returns the facility's UUID (either existing or newly created).
 */
export async function upsertFacility(client: pg.Client, facility: FacilityYaml): Promise<string> {
  // Build EWKT string for PostGIS
  const locationWkt = `SRID=4326;POINT(${facility.location.lng} ${facility.location.lat})`;

  // last_verified: parse YYYY-MM-DD string to a Date (or null)
  const lastVerified = facility.last_verified ? new Date(facility.last_verified) : null;

  const result = await client.query<{ id: string }>(
    `
    INSERT INTO facilities (
      slug, name, operator, tenant_type, tenants, status,
      location, address, city, county, state, fips,
      acres, sqft, year_built, it_load_mw, total_mw,
      design_pue, cooling_type, reported_wue, power_sources,
      water_source, construction_capex_usd,
      jobs_construction, jobs_permanent,
      subsidies, sources, confidence, last_verified,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7::geography, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21,
      $22, $23,
      $24, $25,
      $26, $27, $28, $29,
      now()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name                  = EXCLUDED.name,
      operator              = EXCLUDED.operator,
      tenant_type           = EXCLUDED.tenant_type,
      tenants               = EXCLUDED.tenants,
      status                = EXCLUDED.status,
      location              = EXCLUDED.location,
      address               = EXCLUDED.address,
      city                  = EXCLUDED.city,
      county                = EXCLUDED.county,
      state                 = EXCLUDED.state,
      fips                  = EXCLUDED.fips,
      acres                 = EXCLUDED.acres,
      sqft                  = EXCLUDED.sqft,
      year_built            = EXCLUDED.year_built,
      it_load_mw            = EXCLUDED.it_load_mw,
      total_mw              = EXCLUDED.total_mw,
      design_pue            = EXCLUDED.design_pue,
      cooling_type          = EXCLUDED.cooling_type,
      reported_wue          = EXCLUDED.reported_wue,
      power_sources         = EXCLUDED.power_sources,
      water_source          = EXCLUDED.water_source,
      construction_capex_usd = EXCLUDED.construction_capex_usd,
      jobs_construction     = EXCLUDED.jobs_construction,
      jobs_permanent        = EXCLUDED.jobs_permanent,
      subsidies             = EXCLUDED.subsidies,
      sources               = EXCLUDED.sources,
      confidence            = EXCLUDED.confidence,
      last_verified         = EXCLUDED.last_verified,
      updated_at            = now()
    RETURNING id
    `,
    [
      facility.slug, // $1
      facility.name, // $2
      facility.operator, // $3
      facility.tenant_type, // $4
      facility.tenants ?? null, // $5
      facility.status, // $6
      locationWkt, // $7
      facility.address ?? null, // $8
      facility.city ?? null, // $9
      facility.county ?? null, // $10
      facility.state ?? null, // $11
      facility.fips ?? null, // $12
      facility.acres ?? null, // $13
      facility.sqft ?? null, // $14
      facility.year_built ?? null, // $15
      facility.it_load_mw ?? null, // $16
      facility.total_mw ?? null, // $17
      facility.design_pue ?? null, // $18
      facility.cooling_type ?? null, // $19
      facility.reported_wue ?? null, // $20
      facility.power_sources ? JSON.stringify(facility.power_sources) : null, // $21
      facility.water_source ?? null, // $22
      facility.construction_capex_usd ?? null, // $23
      facility.jobs_construction ?? null, // $24
      facility.jobs_permanent ?? null, // $25
      facility.subsidies ? JSON.stringify(facility.subsidies) : null, // $26
      JSON.stringify(facility.sources), // $27
      facility.confidence, // $28
      lastVerified, // $29
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error(`Upsert returned no rows for slug: ${facility.slug}`);
  return row.id;
}

// ---------------------------------------------------------------------------
// Estimate insert (append-only)
// ---------------------------------------------------------------------------

/**
 * Inserts a new estimate row for a facility.
 * Always inserts (never updates) — old rows are preserved for audit.
 */
export async function insertEstimate(
  client: pg.Client,
  facilityId: string,
  estimate: FacilityEstimateResult
): Promise<void> {
  await client.query(
    `
    INSERT INTO facility_estimates (
      facility_id, methodology_version,
      estimated_annual_gwh, estimated_annual_gwh_low, estimated_annual_gwh_high,
      estimated_annual_gallons, estimated_annual_gallons_low, estimated_annual_gallons_high,
      inputs, computed_at
    ) VALUES (
      $1, $2,
      $3, $4, $5,
      $6, $7, $8,
      $9, now()
    )
    `,
    [
      facilityId,
      estimate.inputs.methodology_version,
      estimate.estimated_annual_gwh,
      estimate.estimated_annual_gwh_low,
      estimate.estimated_annual_gwh_high,
      estimate.estimated_annual_gallons,
      estimate.estimated_annual_gallons_low,
      estimate.estimated_annual_gallons_high,
      JSON.stringify(estimate.inputs),
    ]
  );
}

// ---------------------------------------------------------------------------
// Connection factory (exported so the entry point can create and tear down)
// ---------------------------------------------------------------------------

export function createPgClient(connectionString: string): pg.Client {
  return new Client({ connectionString });
}
