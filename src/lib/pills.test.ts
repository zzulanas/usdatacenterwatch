import { describe, it, expect } from 'vitest';
import { confidencePillStyle, statusPillStyle, statusLabel, CONFIDENCE_STYLES } from './pills';

describe('confidencePillStyle', () => {
  it('returns an object with border and color for each confidence level', () => {
    for (const level of ['high', 'medium', 'low'] as const) {
      const style = confidencePillStyle(level);
      expect(typeof style.border).toBe('string');
      expect(typeof style.color).toBe('string');
      expect(typeof style.background).toBe('string');
      expect(style.borderRadius).toBe('9999px');
    }
  });

  it('high confidence uses emerald palette', () => {
    const style = confidencePillStyle('high');
    expect(style.border).toContain(CONFIDENCE_STYLES.high.border);
    expect(style.color).toBe(CONFIDENCE_STYLES.high.fg);
    expect(style.background).toBe(CONFIDENCE_STYLES.high.bg);
  });

  it('medium confidence uses amber palette', () => {
    const style = confidencePillStyle('medium');
    expect(style.border).toContain(CONFIDENCE_STYLES.medium.border);
  });

  it('low confidence uses gray palette', () => {
    const style = confidencePillStyle('low');
    expect(style.border).toContain(CONFIDENCE_STYLES.low.border);
  });
});

describe('statusPillStyle', () => {
  it('returns null for operational (the default state)', () => {
    expect(statusPillStyle('operational')).toBeNull();
    expect(statusPillStyle(undefined)).toBeNull();
  });

  it('returns a style object for non-operational statuses', () => {
    for (const status of ['under_construction', 'announced', 'decommissioned'] as const) {
      const style = statusPillStyle(status);
      expect(style).not.toBeNull();
      expect(style!.borderRadius).toBe('9999px');
      expect(typeof style!.color).toBe('string');
    }
  });

  it('under_construction uses amber', () => {
    const style = statusPillStyle('under_construction');
    expect(style!.color).toBe('#f59e0b');
  });
});

describe('statusLabel', () => {
  it('returns human-readable labels', () => {
    expect(statusLabel('operational')).toBe('operational');
    expect(statusLabel('under_construction')).toBe('under construction');
    expect(statusLabel('announced')).toBe('announced');
    expect(statusLabel('decommissioned')).toBe('decommissioned');
  });

  it('handles undefined as operational', () => {
    expect(statusLabel(undefined)).toBe('operational');
  });
});
