import { describe, it, expect } from 'vitest';
import { formatCapex, formatGwh, formatGallons, facilityIssueLink } from './format';

describe('formatCapex', () => {
  it('formats billions with one decimal', () => {
    expect(formatCapex(2_000_000_000)).toBe('$2.0B');
    expect(formatCapex(1_500_000_000)).toBe('$1.5B');
    expect(formatCapex(1_800_000_000)).toBe('$1.8B');
  });

  it('formats millions without decimal', () => {
    expect(formatCapex(250_000_000)).toBe('$250M');
    expect(formatCapex(1_000_000)).toBe('$1M');
  });

  it('formats sub-million with commas', () => {
    expect(formatCapex(500_000)).toBe('$500,000');
  });

  it('billion boundary takes priority', () => {
    expect(formatCapex(1_000_000_000)).toBe('$1.0B');
  });
});

describe('formatGwh', () => {
  it('formats with locale separators', () => {
    expect(formatGwh(1230.1)).toBe('1,230.1');
    expect(formatGwh(500)).toBe('500');
  });
});

describe('formatGallons', () => {
  it('formats billions', () => {
    expect(formatGallons(2_000_000_000)).toBe('2.0 B');
  });

  it('formats millions', () => {
    expect(formatGallons(5_000_000)).toBe('5.0 M');
  });

  it('formats sub-million with locale', () => {
    expect(formatGallons(500_000)).toBe('500,000');
  });
});

describe('facilityIssueLink', () => {
  it('includes the template parameter', () => {
    const url = facilityIssueLink('meta-prineville-or', 'Prineville Campus');
    expect(url).toContain('template=facility-correction.md');
  });

  it('includes the slug in the title', () => {
    const url = facilityIssueLink('meta-prineville-or', 'Prineville Campus');
    expect(url).toContain('meta-prineville-or');
  });

  it('points to the correct GitHub repo', () => {
    const url = facilityIssueLink('some-slug', 'Some Name');
    expect(url).toContain('github.com/zzulanas/usdatacenterwatch');
  });
});
