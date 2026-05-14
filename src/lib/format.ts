/**
 * format.ts — display formatting helpers for facility data.
 *
 * Pure functions, no side effects. Used in both the facility detail page
 * and the methodology page. Tested in format.test.ts.
 */

/**
 * Format a USD amount as a compact string:
 *   ≥ 1B  →  "$X.XB"
 *   ≥ 1M  →  "$NMM" (no decimal for millions)
 *   < 1M  →  "$N,NNN"
 */
export function formatCapex(usd: number): string {
  if (usd >= 1_000_000_000) {
    return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  }
  if (usd >= 1_000_000) {
    return `$${Math.round(usd / 1_000_000)}M`;
  }
  return `$${usd.toLocaleString('en-US')}`;
}

/**
 * Format a GWh/yr figure for display.
 * Returns a locale-formatted number string (e.g. "1,230 GWh/yr").
 */
export function formatGwh(gwh: number): string {
  return gwh.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * Format annual gallons as a compact figure.
 *   ≥ 1B  →  "X.X B gal/yr"
 *   ≥ 1M  →  "X M gal/yr"
 *   else  →  locale number
 */
export function formatGallons(gal: number): string {
  if (gal >= 1_000_000_000) {
    return (gal / 1_000_000_000).toFixed(1) + ' B';
  }
  if (gal >= 1_000_000) {
    return (gal / 1_000_000).toFixed(1) + ' M';
  }
  return gal.toLocaleString('en-US');
}

const REPO_NEW_ISSUE = 'https://github.com/zzulanas/usdatacenterwatch/issues/new';

/**
 * Build a pre-filled GitHub issue URL for a facility correction.
 * Matches the pattern used in MapView.tsx's `issueLinkFor`.
 */
export function facilityIssueLink(slug: string, name: string): string {
  const title = `[data]: ${slug}`;
  const body = [
    `**Facility slug:** \`${slug}\``,
    `**Facility name:** ${name}`,
    '',
    `**What's wrong, missing, or stale?**`,
    '',
    `**Source(s) supporting the correction:**`,
    `- URL: `,
    `- Accessed: `,
    `- Which fields it backs: `,
    '',
    `**Additional context:**`,
  ].join('\n');
  const params = new URLSearchParams({
    template: 'facility-correction.md',
    title,
    body,
  });
  return `${REPO_NEW_ISSUE}?${params.toString()}`;
}
