# Database

Neon Postgres 17 + PostGIS 3.5 — used only by the ingest pipeline and admin scripts. **The public website never queries the database directly.** See `CLAUDE.md` for the static read-path invariant.

## Project details

- **Project:** `usdatacenterwatch` (id `solitary-mode-65922129`)
- **Region:** `aws-us-east-2`
- **Branch:** `main` (id `br-orange-glade-ajq2lz60`)
- **Extensions pre-enabled on `main`:** `postgis 3.5.0`, `postgis_topology`, `pgcrypto`

## Schema files

| File                                            | Purpose                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                              | Drizzle ORM schema — TypeScript source of truth for table shapes                        |
| `drizzle/migrations/0001_enable_extensions.sql` | Enables `postgis` and `pgcrypto` extensions (idempotent)                                |
| `drizzle/migrations/0002_facilities_schema.sql` | Creates `facilities` and `facility_estimates` tables, indexes, and `updated_at` trigger |
| `drizzle.config.ts`                             | drizzle-kit configuration                                                               |
| `scripts/db-migrate.ts`                         | Migration runner (uses `pg` client; reads `DATABASE_URL`)                               |

## Migration workflow

### Normal flow

```bash
# 1. Edit src/db/schema.ts
# 2. Generate a new migration SQL file from the schema diff
pnpm db:generate

# 3. Review the generated SQL in drizzle/migrations/ — never skip this step!
# 4. Apply pending migrations to the database
pnpm db:migrate
```

The migration runner tracks applied files in a `__drizzle_migrations` table and skips already-applied files, so `pnpm db:migrate` is idempotent.

### Spinning up a Neon dev branch for prototyping

```bash
source .env   # load NEON_API_KEY

# Create a branch from main
RESP=$(curl -sS -X POST \
  "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"branch":{"name":"dev/my-feature"},"endpoints":[{"type":"read_write"}]}')

TEST_URL=$(echo "$RESP" | jq -r '.connection_uris[0].connection_uri')
BRANCH_ID=$(echo "$RESP" | jq -r '.branch.id')

# Run migrations against the dev branch
DATABASE_URL="$TEST_URL" pnpm db:migrate

# ... prototype, then delete when done
curl -sS -X DELETE \
  "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}" \
  -H "Authorization: Bearer $NEON_API_KEY"
```

For quick schema prototyping only (never in CI):

```bash
DATABASE_URL="$TEST_URL" pnpm db:push
```

## Geography column usage

The `location` column on `facilities` is stored as `geography(Point, 4326)`. The Drizzle column type (`geographyPoint`) maps `{ lng, lat }` in TypeScript to PostGIS EWKT on insert.

### Inserting a facility

```typescript
import { db } from '@/db/client.js';
import { facilities } from '@/db/schema.js';

await db.insert(facilities).values({
  slug: 'meta-prineville-or',
  name: 'Meta Prineville Campus',
  operator: 'Meta',
  tenantType: 'hyperscaler',
  status: 'operational',
  location: { lng: -120.894, lat: 44.3005 },
  confidence: 'high',
  sources: [],
});
```

### Querying with coordinates

The Neon HTTP driver returns `location` as hex WKB, which `geographyPoint.fromDriver` parses back to `{ lng, lat }`. For PostGIS spatial operations, use `sql` template literals:

```typescript
import { sql } from 'drizzle-orm';

// Find facilities within 50 km of a point
const nearby = await db.execute(sql`
  SELECT id, slug, name,
         ST_X(location::geometry) AS lng,
         ST_Y(location::geometry) AS lat,
         ST_Distance(location, ST_GeogFromText('SRID=4326;POINT(-77.0 38.9)')) AS dist_m
  FROM facilities
  WHERE ST_DWithin(
    location,
    ST_GeogFromText('SRID=4326;POINT(-77.0 38.9)'),
    50000   -- meters
  )
  ORDER BY dist_m
`);
```

## Hyperdrive deferral

> **TODO (USD-??):** Configure Cloudflare Hyperdrive for the ingest Worker path.

Hyperdrive is deliberately deferred from v1. The public read path is entirely static (JSON from R2) and never touches Neon. The ingest pipeline runs in GitHub Actions using Neon's pooled connection string (`DATABASE_URL_POOLED`), which already handles connection pooling adequately for our single-writer access pattern.

When we add a submission Worker (v2+) that writes to a `submissions` table from the edge, Hyperdrive should be wired in at that point to avoid cold-connection overhead. At that time, add `HYPERDRIVE_BINDING` to `wrangler.toml` and swap the client to use the Hyperdrive connection string.

## Environment variables

| Variable              | Purpose                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`        | Direct Neon connection string (used by migration scripts and ingest pipeline) |
| `DATABASE_URL_POOLED` | PgBouncer-pooled connection string (used by GitHub Actions ingest runs)       |
| `NEON_API_KEY`        | Neon API key for branch management                                            |
| `NEON_PROJECT_ID`     | Neon project id (`solitary-mode-65922129`)                                    |
| `NEON_BRANCH_ID`      | Main branch id (`br-orange-glade-ajq2lz60`)                                   |

See `.env.example` for the full list.
