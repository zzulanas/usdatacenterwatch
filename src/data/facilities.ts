/**
 * Hardcoded seed facilities for the USD-10 map prototype.
 *
 * TEMPORARY — superseded by the YAML→DB→R2 pipeline (USD-11 / M2).
 *
 * Shape is intentionally a narrow subset of the canonical DESIGN.md data model
 * (slug, operator, location, mw, confidence, source_url) so consumers built on
 * top of this interface only need a trivial refactor when the real dataset
 * lands.
 *
 * Source notes:
 *   - Meta and Google publish per-campus capacity in sustainability reports
 *     and operator pages; those entries are `confidence: 'high'` or 'medium'.
 *   - AWS does not publish per-campus MW disclosures. The Ashburn figure is an
 *     industry-estimated approximation and is marked `confidence: 'low'`.
 *   - Microsoft publishes regional fact sheets but rarely per-campus MW;
 *     marked 'medium'.
 *
 * The `confidence` field round-trips through the canonical DB schema in
 * `src/db/schema.ts`. Curation rigor (primary sources for every datapoint) is
 * the explicit goal of USD-11.
 */
export interface Facility {
  /** Human-readable unique slug, e.g. `meta-prineville-or`. Canonical key per DESIGN.md. */
  slug: string;
  name: string;
  operator: string;
  lat: number;
  lng: number;
  /** Nameplate or announced MW capacity from public sources. */
  mw: number;
  /** Sourcing confidence — drives UI affordances (low → "estimated", high → "operator-disclosed"). */
  confidence: 'high' | 'medium' | 'low';
  /**
   * Lifecycle stage. Drives map dot styling (teal filled / amber filled /
   * gray outline / dim red) so users can tell active scale from pipeline
   * scale at a glance. Optional on this seed type so older fallback entries
   * default to "operational" in MapView.
   */
  status?: 'operational' | 'under_construction' | 'announced' | 'decommissioned';
  /** URL of a public document supporting the MW value above. */
  source_url: string;
}

export const SEED_FACILITIES: Facility[] = [
  {
    slug: 'meta-prineville-or',
    name: 'Meta Prineville Data Center',
    operator: 'Meta',
    lat: 44.3098,
    lng: -120.8349,
    mw: 490,
    confidence: 'high',
    source_url: 'https://sustainability.atmeta.com/data-centers/',
  },
  {
    slug: 'google-council-bluffs-ia',
    name: 'Google Council Bluffs Data Center',
    operator: 'Google',
    lat: 41.2619,
    lng: -95.8608,
    mw: 400,
    confidence: 'medium',
    source_url: 'https://www.google.com/about/datacenters/locations/council-bluffs/',
  },
  {
    slug: 'aws-ashburn-va',
    name: 'AWS Ashburn (IAD) Data Center Campus',
    operator: 'Amazon Web Services',
    lat: 39.0438,
    lng: -77.4874,
    // AWS does not publish per-campus capacity. Figure is an industry-estimated
    // approximation; do not promote to confidence: 'high' without a primary source.
    mw: 800,
    confidence: 'low',
    source_url: 'https://aws.amazon.com/about-aws/sustainability/',
  },
  {
    slug: 'microsoft-boydton-va',
    name: 'Microsoft Boydton Data Center',
    operator: 'Microsoft',
    lat: 36.6673,
    lng: -78.3797,
    mw: 345,
    confidence: 'medium',
    source_url: 'https://datacenters.microsoft.com/globe/fact-sheets/en-us/south-central-us.pdf',
  },
  {
    slug: 'meta-eagle-mountain-ut',
    name: 'Meta Eagle Mountain Data Center',
    operator: 'Meta',
    lat: 40.3144,
    lng: -112.0052,
    mw: 500,
    confidence: 'medium',
    source_url:
      'https://www.utahbusiness.com/meta-announces-2-billion-data-center-in-eagle-mountain/',
  },
];

/** Radius scaling helper: visual size proportional to sqrt(MW). */
export function facilityRadius(mw: number): number {
  return Math.sqrt(mw) * 1500;
}
