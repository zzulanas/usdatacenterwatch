import { describe, it, expect } from 'vitest';
import { facilityRadius, SEED_FACILITIES } from './facilities';

describe('facilityRadius()', () => {
  it('returns 0 for 0 MW', () => {
    expect(facilityRadius(0)).toBe(0);
  });

  it('scales with sqrt(mw) * 1500', () => {
    expect(facilityRadius(100)).toBeCloseTo(Math.sqrt(100) * 1500);
    expect(facilityRadius(400)).toBeCloseTo(Math.sqrt(400) * 1500);
  });

  it('larger MW produces larger radius', () => {
    expect(facilityRadius(800)).toBeGreaterThan(facilityRadius(400));
  });

  it('grows sub-linearly (sqrt relationship)', () => {
    // Quadrupling MW (100 → 400) should double the radius, not quadruple it.
    const ratio = facilityRadius(400) / facilityRadius(100);
    expect(ratio).toBeCloseTo(2); // sqrt(400)/sqrt(100) = 20/10 = 2
  });
});

describe('SEED_FACILITIES', () => {
  it('has exactly 5 facilities', () => {
    expect(SEED_FACILITIES).toHaveLength(5);
  });

  it('each facility has required fields', () => {
    for (const f of SEED_FACILITIES) {
      expect(f.slug).toBeTruthy();
      expect(f.slug).toMatch(/^[a-z0-9-]+$/);
      expect(f.name).toBeTruthy();
      expect(f.operator).toBeTruthy();
      expect(f.lat).toBeGreaterThan(20); // continental US range
      expect(f.lat).toBeLessThan(50);
      expect(f.lng).toBeGreaterThan(-130);
      expect(f.lng).toBeLessThan(-60);
      expect(f.mw).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(f.confidence);
      expect(f.source_url).toMatch(/^https:\/\//);
    }
  });

  it('slugs are unique', () => {
    const slugs = SEED_FACILITIES.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('includes expected operators', () => {
    const operators = SEED_FACILITIES.map((f) => f.operator);
    expect(operators).toContain('Meta');
    expect(operators).toContain('Google');
    expect(operators).toContain('Microsoft');
  });
});
