/**
 * pills.ts — shared confidence and status pill utilities.
 *
 * Extracted from MapView.tsx so the tooltip and the facility detail page
 * can render identical badge styling without duplicating palette values.
 *
 * All functions return plain-object style records so callers can use them
 * in Astro templates (inline style={...}) or React inline styles alike.
 */

import type { ConfidenceType, StatusType } from '@/lib/zod-facility-schema';

// ---------------------------------------------------------------------------
// Confidence pill
// ---------------------------------------------------------------------------

/** Emerald = operator-disclosed, amber = derived/trade-press, gray = OSM/thin */
export const CONFIDENCE_STYLES: Record<
  ConfidenceType,
  { bg: string; border: string; fg: string; label: string }
> = {
  high: {
    bg: '#064e3b',
    border: '#10b981',
    fg: '#d1fae5',
    label: 'high confidence',
  },
  medium: {
    bg: '#78350f',
    border: '#f59e0b',
    fg: '#fef3c7',
    label: 'medium confidence',
  },
  low: {
    bg: '#374151',
    border: '#6b7280',
    fg: '#d1d5db',
    label: 'low confidence',
  },
};

/** Inline style object for a confidence pill. Use in Astro style={} attributes. */
export function confidencePillStyle(confidence: ConfidenceType): Record<string, string | number> {
  const s = CONFIDENCE_STYLES[confidence];
  return {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: s.bg,
    border: `1px solid ${s.border}`,
    color: s.fg,
    padding: '2px 8px',
    borderRadius: '9999px',
  };
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<StatusType, { border: string; fg: string; label: string }> = {
  operational: {
    border: '#4fd1c5',
    fg: '#4fd1c5',
    label: 'operational',
  },
  under_construction: {
    border: '#f59e0b',
    fg: '#f59e0b',
    label: 'under construction',
  },
  announced: {
    border: '#9ca3af',
    fg: '#9ca3af',
    label: 'announced',
  },
  decommissioned: {
    border: '#b91c1c',
    fg: '#ef4444',
    label: 'decommissioned',
  },
};

/** Inline style object for a status pill. Use in Astro style={} attributes.
 *  Returns null for `operational` — it's the default and doesn't need a badge. */
export function statusPillStyle(
  status: StatusType | undefined
): Record<string, string | number> | null {
  if (!status || status === 'operational') return null;
  const s = STATUS_STYLES[status];
  return {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: 'transparent',
    border: `1px solid ${s.border}`,
    color: s.fg,
    padding: '2px 8px',
    borderRadius: '9999px',
  };
}

/** Human-readable label for a status value. */
export function statusLabel(status: StatusType | undefined): string {
  if (!status) return 'operational';
  return STATUS_STYLES[status]?.label ?? status;
}
