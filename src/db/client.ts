// SERVER-ONLY. Never import from src/pages/* or src/components/*.
//
// This module uses @neondatabase/serverless HTTP driver, which works in both
// Node.js scripts (ingest pipeline, migrations) and edge runtimes.
// Connection string is read from DATABASE_URL at import time — set the env var
// before importing this module.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Server-only DB client requires DATABASE_URL.');
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });

export type DB = typeof db;
