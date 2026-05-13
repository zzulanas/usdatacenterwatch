-- Migration 0002: create facilities and facility_estimates tables
-- Matches DESIGN.md § "Data model" exactly.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE tenant_type AS ENUM ('hyperscaler', 'colo', 'crypto', 'enterprise');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE status AS ENUM ('operational', 'under_construction', 'announced', 'decommissioned');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE cooling_type AS ENUM ('air', 'evap', 'liquid', 'hybrid');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE water_source AS ENUM ('municipal', 'reclaimed', 'well', 'surface', 'unknown');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE confidence AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- facilities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facilities (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text          UNIQUE NOT NULL,
  name                    text          NOT NULL,
  operator                text          NOT NULL,
  tenant_type             tenant_type   NOT NULL,
  tenants                 text[],
  status                  status        NOT NULL,
  location                geography(Point, 4326) NOT NULL,
  address                 text,
  city                    text,
  county                  text,
  state                   text,
  fips                    text,
  acres                   numeric,
  sqft                    numeric,
  year_built              integer,
  it_load_mw              numeric,
  total_mw                numeric,
  design_pue              numeric,
  cooling_type            cooling_type,
  reported_wue            numeric,
  power_sources           jsonb,
  water_source            water_source,
  construction_capex_usd  numeric,
  jobs_construction       integer,
  jobs_permanent          integer,
  subsidies               jsonb,
  sources                 jsonb         NOT NULL DEFAULT '[]',
  confidence              confidence    NOT NULL,
  last_verified           timestamptz,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- facility_estimates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facility_estimates (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id                  uuid        NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  methodology_version          text        NOT NULL,
  estimated_annual_gwh         numeric,
  estimated_annual_gwh_low     numeric,
  estimated_annual_gwh_high    numeric,
  estimated_annual_gallons     numeric,
  estimated_annual_gallons_low  numeric,
  estimated_annual_gallons_high numeric,
  inputs                       jsonb       NOT NULL,
  computed_at                  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- GIST index on geography column for spatial queries
CREATE INDEX IF NOT EXISTS facilities_location_gist
  ON facilities USING GIST (location);

-- B-tree indexes for common filter columns
CREATE INDEX IF NOT EXISTS facilities_state_idx     ON facilities (state);
CREATE INDEX IF NOT EXISTS facilities_operator_idx  ON facilities (operator);
CREATE INDEX IF NOT EXISTS facilities_status_idx    ON facilities (status);
CREATE INDEX IF NOT EXISTS facilities_tenant_type_idx ON facilities (tenant_type);

-- B-tree index for FK join
CREATE INDEX IF NOT EXISTS facility_estimates_facility_id_idx
  ON facility_estimates (facility_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facilities_set_updated_at ON facilities;
CREATE TRIGGER facilities_set_updated_at
  BEFORE UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
