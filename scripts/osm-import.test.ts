/**
 * osm-import.test.ts — unit tests for the OSM bulk import pipeline.
 *
 * Coverage:
 *  1. normalizeOsmElement — happy path, quality filters, operator alias, tenant type
 *  2. shouldDedup — slug collision, 500m proximity, no collision
 *  3. isWithinConusBbox — inside/outside CONUS
 *  4. slugify — various inputs
 *  5. normalizeOperator / deriveTenantType — alias map round-trips
 *  6. Full YAML file tree validation — every data/facilities/**‌/‌*.yaml passes Zod strict
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  normalizeOsmElement,
  shouldDedup,
  isWithinConusBbox,
  slugify,
  normalizeOperator,
  deriveTenantType,
  haversineMeters,
  OPERATOR_ALIASES,
  type OsmElement,
  type NormalizedFacility,
  type ExistingFacility,
} from './osm-import.js';
import { loadYamlFiles } from './ingest/yaml-loader.js';
import { validateFacilities } from './ingest/validate.js';

const TODAY = '2026-05-13';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeWay(
  id: number,
  tags: Record<string, string>,
  center: { lat: number; lon: number }
): OsmElement {
  return { type: 'way', id, tags, center };
}

function makeRelation(
  id: number,
  tags: Record<string, string>,
  center: { lat: number; lon: number }
): OsmElement {
  return { type: 'relation', id, tags, center };
}

function makeNode(id: number, tags: Record<string, string>, lat: number, lon: number): OsmElement {
  return { type: 'node', id, tags, lat, lon };
}

// ---------------------------------------------------------------------------
// Fixture data from the VA sample
// ---------------------------------------------------------------------------

const VA_IAD11: OsmElement = makeWay(
  45776978,
  {
    'addr:city': 'Manassas',
    'addr:housenumber': '7510',
    'addr:postcode': '20109',
    'addr:state': 'VA',
    'addr:street': 'Mason King Court',
    building: 'data_center',
    name: 'Amazon IAD11',
    operator: 'Amazon Web Services',
    'operator:short': 'AWS',
    telecom: 'data_center',
  },
  { lat: 38.7904948, lon: -77.5411095 }
);

const VA_DIGITAL_REALTY: OsmElement = makeWay(
  46831933,
  {
    'addr:city': 'Bristow',
    'addr:state': 'VA',
    'addr:street': 'Linton Hall Road',
    'addr:housenumber': '8217',
    building: 'data_center',
    name: 'VA 4',
    operator: 'Digital Realty',
    telecom: 'data_center',
  },
  { lat: 38.7780614, lon: -77.594905 }
);

const OUTSIDE_CONUS: OsmElement = makeWay(
  999,
  {
    'addr:city': 'Anchorage',
    'addr:state': 'AK',
    name: 'Alaska DC',
    operator: 'SomeOp',
    telecom: 'data_center',
  },
  { lat: 60.1, lon: -149.9 }
);

const NO_NAME_NO_OP: OsmElement = makeWay(
  888,
  { building: 'data_center', telecom: 'data_center' },
  { lat: 38.8, lon: -77.5 }
);

const NO_CITY: OsmElement = makeWay(
  777,
  { name: 'Unnamed DC', operator: 'SomeOp', telecom: 'data_center' },
  { lat: 38.9, lon: -77.4 }
);

const AWS_ALIAS_ELEMENT: OsmElement = makeWay(
  444,
  {
    'addr:city': 'Ashburn',
    'addr:state': 'VA',
    name: 'AWS Data Center',
    operator: 'AWS', // alias → should normalize to Amazon Web Services
    telecom: 'data_center',
  },
  { lat: 38.85, lon: -77.3 }
);

const MSFT_ALIAS: OsmElement = makeWay(
  555,
  {
    'addr:city': 'Sterling',
    'addr:state': 'VA',
    name: 'MSFT Data Center',
    operator: 'MSFT',
    telecom: 'data_center',
  },
  { lat: 38.98, lon: -77.42 }
);

// ---------------------------------------------------------------------------
// 1. slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and kebab-cases normal text', () => {
    expect(slugify('Amazon Web Services')).toBe('amazon-web-services');
  });

  it('strips special characters', () => {
    expect(slugify('AT&T')).toBe('att');
  });

  it('collapses multiple spaces/hyphens', () => {
    expect(slugify('The  Dalles')).toBe('the-dalles');
  });

  it('handles already-lower-kebab input', () => {
    expect(slugify('meta-eagle-mountain')).toBe('meta-eagle-mountain');
  });

  it('returns empty string for blank input', () => {
    expect(slugify('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. normalizeOperator
// ---------------------------------------------------------------------------

describe('normalizeOperator', () => {
  it('normalizes AWS → Amazon Web Services', () => {
    expect(normalizeOperator('AWS')).toBe('Amazon Web Services');
  });

  it('normalizes MSFT → Microsoft', () => {
    expect(normalizeOperator('MSFT')).toBe('Microsoft');
  });

  it('normalizes Facebook → Meta', () => {
    expect(normalizeOperator('Facebook')).toBe('Meta');
  });

  it('normalizes Amazon → Amazon Web Services', () => {
    expect(normalizeOperator('Amazon')).toBe('Amazon Web Services');
  });

  it('passes through unknown operators unchanged', () => {
    expect(normalizeOperator('Equinix')).toBe('Equinix');
    expect(normalizeOperator('Digital Realty')).toBe('Digital Realty');
  });

  it('covers all alias map keys without throwing', () => {
    for (const [alias, canonical] of Object.entries(OPERATOR_ALIASES)) {
      expect(normalizeOperator(alias)).toBe(canonical);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. deriveTenantType
// ---------------------------------------------------------------------------

describe('deriveTenantType', () => {
  it('hyperscaler for Amazon Web Services', () => {
    expect(deriveTenantType('Amazon Web Services')).toBe('hyperscaler');
  });

  it('hyperscaler for Google', () => {
    expect(deriveTenantType('Google')).toBe('hyperscaler');
  });

  it('hyperscaler for Microsoft', () => {
    expect(deriveTenantType('Microsoft')).toBe('hyperscaler');
  });

  it('colo for Equinix', () => {
    expect(deriveTenantType('Equinix')).toBe('colo');
  });

  it('colo for Digital Realty', () => {
    expect(deriveTenantType('Digital Realty')).toBe('colo');
  });

  it('enterprise for unknown operator', () => {
    expect(deriveTenantType('Bank of America')).toBe('enterprise');
  });
});

// ---------------------------------------------------------------------------
// 4. isWithinConusBbox
// ---------------------------------------------------------------------------

describe('isWithinConusBbox', () => {
  it('returns true for Ashburn, VA', () => {
    expect(isWithinConusBbox(39.04, -77.49)).toBe(true);
  });

  it('returns true for Los Angeles, CA', () => {
    expect(isWithinConusBbox(34.05, -118.24)).toBe(true);
  });

  it('returns false for Anchorage, AK', () => {
    expect(isWithinConusBbox(61.2, -149.9)).toBe(false);
  });

  it('returns false for Honolulu, HI', () => {
    expect(isWithinConusBbox(21.3, -157.8)).toBe(false);
  });

  it('returns false for London, UK', () => {
    expect(isWithinConusBbox(51.5, -0.1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. haversineMeters
// ---------------------------------------------------------------------------

describe('haversineMeters', () => {
  it('returns 0 for same point', () => {
    expect(haversineMeters(38.8, -77.5, 38.8, -77.5)).toBe(0);
  });

  it('returns ~111 km for 1 degree lat', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });

  it('returns < 500m for very close points (~10m apart)', () => {
    const d = haversineMeters(38.79049, -77.54111, 38.7905, -77.54112);
    expect(d).toBeLessThan(500);
  });

  it('returns > 500m for points ~1km apart', () => {
    // ~1km apart in VA
    const d = haversineMeters(38.7904, -77.5411, 38.8, -77.5411);
    expect(d).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// 6. normalizeOsmElement — happy path
// ---------------------------------------------------------------------------

describe('normalizeOsmElement — happy path', () => {
  it('normalizes a well-tagged way correctly', () => {
    const result = normalizeOsmElement(VA_IAD11, TODAY);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.slug).toBe('amazon-web-services-manassas-va');
    expect(result.operator).toBe('Amazon Web Services');
    expect(result.name).toBe('Amazon IAD11');
    expect(result.tenant_type).toBe('hyperscaler');
    expect(result.status).toBe('operational');
    expect(result.confidence).toBe('low');
    expect(result.location.lat).toBeCloseTo(38.7904948, 5);
    expect(result.location.lng).toBeCloseTo(-77.5411095, 5);
    expect(result.address).toBe('7510 Mason King Court, Manassas, VA');
    expect(result.city).toBe('Manassas');
    expect(result.state).toBe('VA');
    expect(result.osmType).toBe('way');
    expect(result.osmId).toBe(45776978);
    expect(result.sourceUrl).toBe('https://www.openstreetmap.org/way/45776978');
    expect(result.supportedFields).toContain('location');
    expect(result.supportedFields).toContain('name');
    expect(result.supportedFields).toContain('operator');
    expect(result.supportedFields).toContain('city');
    expect(result.supportedFields).toContain('state');
  });

  it('normalizes a relation correctly', () => {
    const rel = makeRelation(
      16282459,
      {
        name: 'CyberNAP Glen Burnie',
        operator: 'AiNET',
        telecom: 'data_center',
        type: 'multipolygon',
        'addr:city': 'Glen Burnie',
        'addr:state': 'MD',
      },
      { lat: 39.14, lon: -76.61 }
    );
    const result = normalizeOsmElement(rel, TODAY);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.osmType).toBe('relation');
    expect(result.sourceUrl).toBe('https://www.openstreetmap.org/relation/16282459');
    expect(result.slug).toBe('ainet-glen-burnie-md');
  });

  it('normalizes operator aliases in the slug', () => {
    const result = normalizeOsmElement(AWS_ALIAS_ELEMENT, TODAY);
    expect(result).not.toBeNull();
    if (!result) return;
    // AWS should normalize to amazon-web-services in the slug
    expect(result.slug).toBe('amazon-web-services-ashburn-va');
    expect(result.operator).toBe('Amazon Web Services');
  });

  it('normalizes MSFT alias', () => {
    const result = normalizeOsmElement(MSFT_ALIAS, TODAY);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.operator).toBe('Microsoft');
    expect(result.slug).toContain('microsoft');
  });

  it('uses "{operator} Data Center" as name when OSM name is absent', () => {
    const el = makeWay(
      123,
      {
        'addr:city': 'Ashburn',
        'addr:state': 'VA',
        operator: 'CyrusOne',
        telecom: 'data_center',
      },
      { lat: 38.9, lon: -77.4 }
    );
    const result = normalizeOsmElement(el, TODAY);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.name).toBe('CyrusOne Data Center');
  });

  it('omits address when housenumber or street is missing', () => {
    const el = makeWay(
      456,
      {
        'addr:city': 'Reston',
        'addr:state': 'VA',
        'addr:street': 'Innovation Ave',
        // no addr:housenumber
        name: 'Some DC',
        operator: 'Equinix',
        telecom: 'data_center',
      },
      { lat: 38.96, lon: -77.35 }
    );
    const result = normalizeOsmElement(el, TODAY);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.address).toBeUndefined();
  });

  it('Digital Realty is classified as colo', () => {
    const result = normalizeOsmElement(VA_DIGITAL_REALTY, TODAY);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.tenant_type).toBe('colo');
  });
});

// ---------------------------------------------------------------------------
// 7. normalizeOsmElement — quality filters (should return null)
// ---------------------------------------------------------------------------

describe('normalizeOsmElement — quality filters', () => {
  it('skips node elements', () => {
    const node = makeNode(
      999,
      { name: 'Node DC', operator: 'SomeOp', 'addr:city': 'Ashburn', telecom: 'data_center' },
      38.9,
      -77.4
    );
    expect(normalizeOsmElement(node, TODAY)).toBeNull();
  });

  it('skips elements outside CONUS bbox', () => {
    expect(normalizeOsmElement(OUTSIDE_CONUS, TODAY)).toBeNull();
  });

  it('skips elements with no name and no operator', () => {
    expect(normalizeOsmElement(NO_NAME_NO_OP, TODAY)).toBeNull();
  });

  it('skips elements with no addr:city', () => {
    expect(normalizeOsmElement(NO_CITY, TODAY)).toBeNull();
  });

  it('skips elements with no center point', () => {
    const noCenter: OsmElement = {
      type: 'way',
      id: 1,
      tags: { name: 'DC', operator: 'X', 'addr:city': 'Ashburn', telecom: 'data_center' },
    };
    expect(normalizeOsmElement(noCenter, TODAY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. shouldDedup
// ---------------------------------------------------------------------------

describe('shouldDedup', () => {
  const existing: ExistingFacility[] = [
    { slug: 'amazon-web-services-manassas-va', lat: 38.7905, lng: -77.5411 },
    { slug: 'microsoft-boydton-va', lat: 36.6669, lng: -78.3897 },
  ];

  it('deduplicates on exact slug collision', () => {
    const incoming: NormalizedFacility = {
      slug: 'amazon-web-services-manassas-va',
      name: 'Amazon IAD11',
      operator: 'Amazon Web Services',
      tenant_type: 'hyperscaler',
      status: 'operational',
      location: { lat: 38.9, lng: -77.5 }, // different coords but same slug
      city: 'Manassas',
      state: 'VA',
      confidence: 'low',
      osmType: 'way',
      osmId: 1,
      sourceUrl: 'https://www.openstreetmap.org/way/1',
      supportedFields: ['name', 'location'],
    };
    expect(shouldDedup(incoming, existing)).toBe('amazon-web-services-manassas-va');
  });

  it('deduplicates on 500m proximity (same campus, different OSM record)', () => {
    const incoming: NormalizedFacility = {
      slug: 'aws-iad11-different-slug',
      name: 'Amazon IAD11 B',
      operator: 'Amazon Web Services',
      tenant_type: 'hyperscaler',
      status: 'operational',
      // 50m from existing IAD11
      location: { lat: 38.79045, lng: -77.54107 },
      city: 'Manassas',
      state: 'VA',
      confidence: 'low',
      osmType: 'way',
      osmId: 2,
      sourceUrl: 'https://www.openstreetmap.org/way/2',
      supportedFields: ['name', 'location'],
    };
    expect(shouldDedup(incoming, existing)).toBe('amazon-web-services-manassas-va');
  });

  it('does NOT dedup when outside 500m radius and slug differs', () => {
    const incoming: NormalizedFacility = {
      slug: 'equinix-ashburn-va',
      name: 'Equinix DC1',
      operator: 'Equinix',
      tenant_type: 'colo',
      status: 'operational',
      // 100km from Microsoft Boydton, 50km from IAD11
      location: { lat: 39.04, lng: -77.48 },
      city: 'Ashburn',
      state: 'VA',
      confidence: 'low',
      osmType: 'way',
      osmId: 3,
      sourceUrl: 'https://www.openstreetmap.org/way/3',
      supportedFields: ['name', 'location'],
    };
    expect(shouldDedup(incoming, existing)).toBeNull();
  });

  it('respects custom radius (100m)', () => {
    const incoming: NormalizedFacility = {
      slug: 'different-slug-close',
      name: 'Near IAD11',
      operator: 'Amazon Web Services',
      tenant_type: 'hyperscaler',
      status: 'operational',
      // ~300m from existing IAD11 (within 500m, outside 100m)
      location: { lat: 38.7932, lng: -77.5411 },
      city: 'Manassas',
      state: 'VA',
      confidence: 'low',
      osmType: 'way',
      osmId: 4,
      sourceUrl: 'https://www.openstreetmap.org/way/4',
      supportedFields: ['name', 'location'],
    };
    // With default 500m radius → dedup
    expect(shouldDedup(incoming, existing, 500)).toBe('amazon-web-services-manassas-va');
    // With 100m radius → no dedup
    expect(shouldDedup(incoming, existing, 100)).toBeNull();
  });

  it('returns null when no existing facilities', () => {
    const incoming: NormalizedFacility = {
      slug: 'brand-new-facility',
      name: 'New DC',
      operator: 'Equinix',
      tenant_type: 'colo',
      status: 'operational',
      location: { lat: 38.9, lng: -77.4 },
      city: 'Ashburn',
      state: 'VA',
      confidence: 'low',
      osmType: 'way',
      osmId: 5,
      sourceUrl: 'https://www.openstreetmap.org/way/5',
      supportedFields: ['name', 'location'],
    };
    expect(shouldDedup(incoming, [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Fixture-based normalizer test using the VA sample JSON
// ---------------------------------------------------------------------------

describe('normalizeOsmElement — VA sample fixture', () => {
  const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'osm-va-sample.json'), 'utf-8')) as {
    elements: OsmElement[];
  };

  it('produces valid slugs for all well-tagged elements', () => {
    const results = raw.elements
      .map((e) => normalizeOsmElement(e, TODAY))
      .filter((r): r is NormalizedFacility => r !== null);

    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      // Slug must be lowercase kebab only
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      // Confidence must be low for all OSM imports
      expect(r.confidence).toBe('low');
      // Status must be operational
      expect(r.status).toBe('operational');
      // Source URL must reference the OSM element
      expect(r.sourceUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/(way|relation)\/\d+$/);
    }
  });

  it('skips the node element in the fixture', () => {
    const nodeResult = raw.elements.find((e) => e.type === 'node');
    expect(nodeResult).toBeDefined();
    expect(normalizeOsmElement(nodeResult!, TODAY)).toBeNull();
  });

  it('skips the outside-CONUS element in the fixture', () => {
    const outsideEl = raw.elements.find((e) => e.type !== 'node' && (e.center?.lat ?? 0) > 55);
    expect(outsideEl).toBeDefined();
    expect(normalizeOsmElement(outsideEl!, TODAY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Full YAML file tree validation
// Every data/facilities/**/*.yaml must pass Zod strict validation.
// This gates the pilot import output before it hits the ingest pipeline.
// ---------------------------------------------------------------------------

describe('data/facilities YAML tree — Zod strict validation', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(__dirname, '..');
  const facilitiesDir = join(projectRoot, 'data', 'facilities');

  const files = loadYamlFiles(facilitiesDir, projectRoot);
  const { valid, failures } = validateFacilities(files);

  it('loads at least 10 facility files', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('every YAML file passes Zod strict validation', () => {
    if (failures.length > 0) {
      const detail = failures
        .map(
          (f) =>
            `  ${f.relativePath}\n` + f.errors.map((e) => `    ${e.field}: ${e.message}`).join('\n')
        )
        .join('\n');
      throw new Error(`${failures.length} YAML file(s) failed strict Zod validation:\n${detail}`);
    }
    expect(failures).toHaveLength(0);
  });

  it('all valid files have confidence set', () => {
    for (const f of valid) {
      expect(f.data.confidence, `${f.relativePath} missing confidence`).toBeDefined();
    }
  });

  it('all valid files have at least one source', () => {
    for (const f of valid) {
      expect(f.data.sources.length, `${f.relativePath} has no sources`).toBeGreaterThanOrEqual(1);
    }
  });

  it('OSM-imported files have confidence: low', () => {
    const osmFiles = valid.filter((f) =>
      f.data.sources.some((s) => s.url.includes('openstreetmap.org'))
    );
    for (const f of osmFiles) {
      expect(f.data.confidence, `${f.relativePath} OSM file must be confidence: low`).toBe('low');
    }
  });
});
