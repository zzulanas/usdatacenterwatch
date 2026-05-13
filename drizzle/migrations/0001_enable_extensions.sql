-- Migration 0001: enable required PostgreSQL extensions
-- Idempotent — safe to run on a Neon branch where these are already enabled.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
