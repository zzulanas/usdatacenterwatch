import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Custom geography type (PostGIS geography(Point, 4326))
// ---------------------------------------------------------------------------

export interface LatLng {
  lng: number;
  lat: number;
}

/**
 * PostGIS geography(Point, 4326) column type.
 *
 * - INSERT: accepts { lng, lat } — serialized to ST_GeogFromText('SRID=4326;POINT(lng lat)')
 * - SELECT: returns { lng, lat } parsed from PostGIS hex WKB string.
 *
 * For queries that need the lat/lng values you can cast to geometry and call
 * ST_X / ST_Y, or use ST_AsText to get the WKT form. See docs/database.md.
 */
export const geographyPoint = customType<{
  data: LatLng;
  driverData: string;
}>({
  dataType() {
    return 'geography(Point, 4326)';
  },
  toDriver(value: LatLng): string {
    const lng = Number(value.lng);
    const lat = Number(value.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new Error(
        `geographyPoint.toDriver: lng/lat must be finite numbers, got ${JSON.stringify(value)}`
      );
    }
    return `SRID=4326;POINT(${lng} ${lat})`;
  },
  fromDriver(value: string): LatLng {
    // PostGIS returns hex WKB by default via the serverless HTTP driver.
    // Parse EWKB hex: bytes 5-8 are SRID flag, then x then y for Point.
    // Layout (little-endian): 1 byte order | 4 int type | 4 int srid | 8 dbl x | 8 dbl y
    if (!value || typeof value !== 'string') {
      throw new Error(`geographyPoint.fromDriver: unexpected value: ${JSON.stringify(value)}`);
    }
    // If it comes back as WKT "POINT(lng lat)" format
    const wktMatch = value.match(/^POINT\s*\(([^\s]+)\s+([^\s)]+)\)$/i);
    if (wktMatch) {
      return { lng: parseFloat(wktMatch[1]), lat: parseFloat(wktMatch[2]) };
    }
    // Parse hex EWKB (little-endian)
    const buf = Buffer.from(value, 'hex');
    // byte 0: byte order (1 = little-endian)
    const byteOrder = buf[0];
    if (byteOrder !== 1) {
      throw new Error(
        `geographyPoint.fromDriver: big-endian WKB not supported (byteOrder=${byteOrder})`
      );
    }
    // bytes 1-4: wkb type (with SRID flag 0x20000000)
    // bytes 5-8: SRID (if present) — we check the SRID flag
    const wkbType = buf.readUInt32LE(1);
    const hasSrid = (wkbType & 0x20000000) !== 0;
    // 1 byte order + 4 type + (optional 4 srid) + 8 x + 8 y
    const xOffset = 1 + 4 + (hasSrid ? 4 : 0);
    const yOffset = xOffset + 8;
    const lng = buf.readDoubleLE(xOffset);
    const lat = buf.readDoubleLE(yOffset);
    return { lng, lat };
  },
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const tenantTypeEnum = pgEnum('tenant_type', [
  'hyperscaler',
  'colo',
  'crypto',
  'enterprise',
]);

export const statusEnum = pgEnum('status', [
  'operational',
  'under_construction',
  'announced',
  'decommissioned',
]);

export const coolingTypeEnum = pgEnum('cooling_type', ['air', 'evap', 'liquid', 'hybrid']);

export const waterSourceEnum = pgEnum('water_source', [
  'municipal',
  'reclaimed',
  'well',
  'surface',
  'unknown',
]);

export const confidenceEnum = pgEnum('confidence', ['high', 'medium', 'low']);

// ---------------------------------------------------------------------------
// facilities table
// ---------------------------------------------------------------------------

export const facilities = pgTable('facilities', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  operator: text('operator').notNull(),
  tenantType: tenantTypeEnum('tenant_type').notNull(),
  tenants: text('tenants').array(),
  status: statusEnum('status').notNull(),
  location: geographyPoint('location').notNull(),
  address: text('address'),
  city: text('city'),
  county: text('county'),
  state: text('state'),
  fips: text('fips'),
  acres: numeric('acres'),
  sqft: numeric('sqft'),
  yearBuilt: integer('year_built'),
  itLoadMw: numeric('it_load_mw'),
  totalMw: numeric('total_mw'),
  designPue: numeric('design_pue'),
  coolingType: coolingTypeEnum('cooling_type'),
  reportedWue: numeric('reported_wue'),
  powerSources: jsonb('power_sources'),
  waterSource: waterSourceEnum('water_source'),
  constructionCapexUsd: numeric('construction_capex_usd'),
  jobsConstruction: integer('jobs_construction'),
  jobsPermanent: integer('jobs_permanent'),
  subsidies: jsonb('subsidies'),
  sources: jsonb('sources')
    .notNull()
    .default(sql`'[]'::jsonb`),
  confidence: confidenceEnum('confidence').notNull(),
  lastVerified: timestamp('last_verified', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ---------------------------------------------------------------------------
// facility_estimates table
// ---------------------------------------------------------------------------

export const facilityEstimates = pgTable('facility_estimates', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id, { onDelete: 'cascade' }),
  methodologyVersion: text('methodology_version').notNull(),
  estimatedAnnualGwh: numeric('estimated_annual_gwh'),
  estimatedAnnualGwhLow: numeric('estimated_annual_gwh_low'),
  estimatedAnnualGwhHigh: numeric('estimated_annual_gwh_high'),
  estimatedAnnualGallons: numeric('estimated_annual_gallons'),
  estimatedAnnualGallonsLow: numeric('estimated_annual_gallons_low'),
  estimatedAnnualGallonsHigh: numeric('estimated_annual_gallons_high'),
  inputs: jsonb('inputs').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Facility = typeof facilities.$inferSelect;
export type NewFacility = typeof facilities.$inferInsert;
export type FacilityEstimate = typeof facilityEstimates.$inferSelect;
export type NewFacilityEstimate = typeof facilityEstimates.$inferInsert;
