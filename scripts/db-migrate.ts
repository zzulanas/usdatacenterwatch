#!/usr/bin/env tsx
/**
 * db-migrate.ts — applies pending SQL migrations from drizzle/migrations/ to Neon.
 *
 * Reads DATABASE_URL from the environment (set it before running, or use .env).
 *
 * Usage:
 *   pnpm db:migrate
 *   DATABASE_URL="postgres://..." pnpm db:migrate
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'drizzle', 'migrations');

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  console.error('ERROR: DATABASE_URL env var is required.');
  process.exit(1);
}

async function migrate() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('Connected to database.');

  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id          serial       PRIMARY KEY,
        name        text         UNIQUE NOT NULL,
        applied_at  timestamptz  NOT NULL DEFAULT now()
      )
    `);

    // Get list of already-applied migrations
    const { rows: applied } = await client.query<{ name: string }>(
      'SELECT name FROM __drizzle_migrations ORDER BY name'
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    // Discover migration files in order
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in', migrationsDir);
      return;
    }

    let ranCount = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip  ${file}  (already applied)`);
        continue;
      }

      const filePath = join(migrationsDir, file);
      const sql = readFileSync(filePath, 'utf-8');

      console.log(`  apply ${file} …`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO __drizzle_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  done  ${file}`);
        ranCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    if (ranCount === 0) {
      console.log('All migrations already applied. Database is up to date.');
    } else {
      console.log(`\nApplied ${ranCount} migration(s) successfully.`);
    }
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
