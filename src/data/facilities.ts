/**
 * Hardcoded seed facilities for USD-10 map prototype.
 * TEMPORARY — will be superseded by the R2 JSON pipeline in USD-11.
 * Each entry carries a source_url per the project's data-sourcing invariant.
 */
export interface Facility {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lng: number;
  /** Nameplate or announced MW capacity from public sources */
  mw: number;
  source_url: string;
}

export const SEED_FACILITIES: Facility[] = [
  {
    id: 'meta-prineville-or',
    name: 'Meta Prineville Data Center',
    operator: 'Meta',
    lat: 44.3098,
    lng: -120.8349,
    mw: 490,
    source_url: 'https://datacenters.com/locations/meta-data-center-prineville-oregon',
  },
  {
    id: 'google-council-bluffs-ia',
    name: 'Google Council Bluffs Data Center',
    operator: 'Google',
    lat: 41.2619,
    lng: -95.8608,
    mw: 400,
    source_url: 'https://www.google.com/about/datacenters/locations/council-bluffs/',
  },
  {
    id: 'aws-ashburn-va',
    name: 'AWS Ashburn (IAD) Data Center Campus',
    operator: 'Amazon Web Services',
    lat: 39.0438,
    lng: -77.4874,
    mw: 800,
    source_url: 'https://aws.amazon.com/about-aws/global-infrastructure/regions_az/',
  },
  {
    id: 'microsoft-boydton-va',
    name: 'Microsoft Boydton Data Center',
    operator: 'Microsoft',
    lat: 36.6673,
    lng: -78.3797,
    mw: 345,
    source_url: 'https://datacenters.microsoft.com/globe/fact-sheets/en-us/south-central-us.pdf',
  },
  {
    id: 'meta-eagle-mountain-ut',
    name: 'Meta Eagle Mountain Data Center',
    operator: 'Meta',
    lat: 40.3144,
    lng: -112.0052,
    mw: 500,
    source_url:
      'https://www.utahbusiness.com/meta-announces-2-billion-data-center-in-eagle-mountain/',
  },
];

/** Radius scaling helper: visual size proportional to sqrt(MW). */
export function facilityRadius(mw: number): number {
  return Math.sqrt(mw) * 1500;
}
