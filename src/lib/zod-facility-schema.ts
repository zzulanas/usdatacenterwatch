/**
 * zod-facility-schema.ts — Zod schema for a YAML facility file.
 *
 * Mirrors src/db/schema.ts field-by-field with human-friendly YAML affordances.
 * This file is intentionally free of DB-client imports — it's pure validation logic
 * so the eventual SSR layer can reuse it if needed.
 *
 * Rules:
 *  - location is { lng, lat } (not WKT)
 *  - power_sources must sum to ~1.0 (±0.01) if present
 *  - sources array is required with min length 1
 *  - .strict() on the root object rejects unknown keys (catches YAML typos early)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enum schemas (match DB enums exactly)
// ---------------------------------------------------------------------------

export const TenantTypeSchema = z.enum(['hyperscaler', 'colo', 'crypto', 'enterprise']);
export const StatusSchema = z.enum([
  'operational',
  'under_construction',
  'announced',
  'decommissioned',
]);
export const CoolingTypeSchema = z.enum(['air', 'evap', 'liquid', 'hybrid']);
export const WaterSourceSchema = z.enum(['municipal', 'reclaimed', 'well', 'surface', 'unknown']);
export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const LocationSchema = z
  .object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  })
  .strict();

export const SourceSchema = z
  .object({
    url: z.url(),
    accessed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'accessed_at must be YYYY-MM-DD'),
    supports: z.array(z.string()).min(1),
  })
  .strict();

export const SubsidySchema = z
  .object({
    program: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    value_usd: z.number().nonnegative(),
    source_url: z.url(),
  })
  .strict();

export const PowerSourcesSchema = z
  .object({
    grid: z.number().min(0).max(1).optional(),
    solar: z.number().min(0).max(1).optional(),
    wind: z.number().min(0).max(1).optional(),
    gas_onsite: z.number().min(0).max(1).optional(),
    nuclear: z.number().min(0).max(1).optional(),
    other: z.number().min(0).max(1).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const total = Object.values(val).reduce<number>((sum, v) => sum + (v ?? 0), 0);
    if (Math.abs(total - 1.0) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        message: `power_sources values must sum to ~1.0 (±0.01), got ${total.toFixed(4)}`,
      });
    }
  });

// ---------------------------------------------------------------------------
// Root facility schema
// ---------------------------------------------------------------------------

export const FacilityYamlSchema = z
  .object({
    // Required identity fields
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'slug must be lowercase kebab-case'),
    name: z.string().min(1),
    operator: z.string().min(1),
    tenant_type: TenantTypeSchema,
    status: StatusSchema,
    location: LocationSchema,
    confidence: ConfidenceSchema,
    sources: z.array(SourceSchema).min(1, 'At least one source is required'),

    // Optional location / description fields
    tenants: z.array(z.string()).optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    county: z.string().optional(),
    state: z.string().length(2).optional(),
    fips: z
      .string()
      .regex(/^\d{5}$/, 'fips must be a 5-digit string')
      .optional(),

    // Physical characteristics
    acres: z.number().positive().optional().nullable(),
    sqft: z.number().positive().optional().nullable(),
    year_built: z.number().int().min(1900).max(2100).optional().nullable(),

    // Power / load
    it_load_mw: z.number().positive().optional().nullable(),
    total_mw: z.number().positive().optional().nullable(),
    design_pue: z.number().min(1.0).optional().nullable(),
    cooling_type: CoolingTypeSchema.optional().nullable(),
    reported_wue: z.number().nonnegative().optional().nullable(),
    power_sources: PowerSourcesSchema.optional().nullable(),

    // Disclosed actuals (operator sustainability reports) — these are
    // calibration anchors, not model inputs. The modeling pipeline reads
    // it_load_mw + design_pue to PRODUCE annual MWh; reported_annual_mwh
    // is the operator's own number, used by scripts/validate-model.ts to
    // verify the model rounds-trips to it within a tolerance. Storing both
    // lets the methodology page show "modeled X vs disclosed Y" transparently.
    reported_annual_mwh: z.number().positive().optional().nullable(),
    reported_annual_mwh_year: z.number().int().min(1900).max(2100).optional().nullable(),
    reported_annual_gallons: z.number().positive().optional().nullable(),
    reported_annual_gallons_year: z.number().int().min(1900).max(2100).optional().nullable(),

    // Water
    water_source: WaterSourceSchema.optional().nullable(),

    // Economic / community impact
    construction_capex_usd: z.number().nonnegative().optional().nullable(),
    jobs_construction: z.number().int().nonnegative().optional().nullable(),
    jobs_permanent: z.number().int().nonnegative().optional().nullable(),
    subsidies: z.array(SubsidySchema).optional().nullable(),

    // Provenance
    last_verified: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'last_verified must be YYYY-MM-DD')
      .optional()
      .nullable(),
  })
  .strict(); // reject unknown keys — catches YAML typos early

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type FacilityYaml = z.infer<typeof FacilityYamlSchema>;
export type TenantType = z.infer<typeof TenantTypeSchema>;
export type StatusType = z.infer<typeof StatusSchema>;
export type CoolingType = z.infer<typeof CoolingTypeSchema>;
export type WaterSourceType = z.infer<typeof WaterSourceSchema>;
export type ConfidenceType = z.infer<typeof ConfidenceSchema>;
export type FacilitySource = z.infer<typeof SourceSchema>;
export type FacilitySubsidy = z.infer<typeof SubsidySchema>;
export type PowerSources = z.infer<typeof PowerSourcesSchema>;
