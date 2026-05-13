/**
 * Tests for load-facilities.ts fallback behavior.
 *
 * We test the no-R2-URL fallback path (the common dev case) via mocking
 * import.meta.env, and verify the module doesn't throw + returns seed data.
 * The live R2 fetch path is integration-tested by the CI export run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers: stub import.meta.env and global fetch before importing the module
// ---------------------------------------------------------------------------

// Vitest exposes `import.meta.env` as a mutable object in the test environment.
// We can stub it directly to control the PUBLIC_R2_BASE_URL value.

describe('loadFacilities()', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns seed facilities when PUBLIC_R2_BASE_URL is not set', async () => {
    // Ensure env var is absent
    vi.stubEnv('PUBLIC_R2_BASE_URL', '');

    // Dynamically import so the module re-reads import.meta.env after the stub
    const { loadFacilities } = await import('./load-facilities');
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const facilities = await loadFacilities();

    expect(Array.isArray(facilities)).toBe(true);
    expect(facilities.length).toBeGreaterThan(0);

    // Each facility must have the minimal fields MapView depends on
    for (const f of facilities) {
      expect(typeof f.slug).toBe('string');
      expect(typeof f.name).toBe('string');
      expect(typeof f.operator).toBe('string');
      expect(typeof f.lat).toBe('number');
      expect(typeof f.lng).toBe('number');
      expect(typeof f.mw).toBe('number');
    }

    // A warning should have been emitted about the missing env var
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PUBLIC_R2_BASE_URL not set'));

    consoleSpy.mockRestore();
  });

  it('falls back to seed data when R2 fetch fails', async () => {
    vi.stubEnv('PUBLIC_R2_BASE_URL', 'https://example-r2.r2.dev');

    // Stub fetch to simulate a network failure
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { loadFacilities } = await import('./load-facilities');
    const facilities = await loadFacilities();

    // Should still return seed data, not throw
    expect(Array.isArray(facilities)).toBe(true);
    expect(facilities.length).toBeGreaterThan(0);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load facilities from R2'),
      expect.any(Error)
    );

    fetchSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('normalizes R2 facilities to include top-level lng/lat/mw', async () => {
    vi.stubEnv('PUBLIC_R2_BASE_URL', 'https://example-r2.r2.dev');

    const mockFacility = {
      slug: 'test-dc-or',
      name: 'Test DC',
      operator: 'TestCo',
      tenant_type: 'hyperscaler',
      status: 'operational',
      location: { lng: -120.5, lat: 44.0 },
      it_load_mw: 100,
      total_mw: 150,
      confidence: 'high' as const,
      sources: [{ url: 'https://example.com', accessed_at: '2026-01-01', supports: ['mw'] }],
      estimate: null,
    };

    const mockManifest = {
      version: '1',
      generated_at: '2026-05-13T00:00:00.000Z',
      facilities_url: 'facilities-abc123.json.gz',
      facility_count: 1,
      methodology_version: '2026-05-v1',
    };

    const mockDataset = {
      version: '1',
      generated_at: '2026-05-13T00:00:00.000Z',
      methodology_version: '2026-05-v1',
      facilities: [mockFacility],
    };

    // Stub fetch: first call → manifest, second → dataset
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDataset,
      } as Response);

    const { loadFacilities } = await import('./load-facilities');
    const facilities = await loadFacilities();

    expect(facilities).toHaveLength(1);
    const f = facilities[0]!;

    // Normalized fields
    expect(f.lng).toBe(-120.5);
    expect(f.lat).toBe(44.0);
    expect(f.mw).toBe(150); // prefers total_mw
    expect(f.source_url).toBe('https://example.com');

    fetchSpy.mockRestore();
  });

  it('uses it_load_mw as mw fallback when total_mw is absent', async () => {
    vi.stubEnv('PUBLIC_R2_BASE_URL', 'https://example-r2.r2.dev');

    const mockFacility = {
      slug: 'test-dc-2',
      name: 'Test DC 2',
      operator: 'TestCo',
      tenant_type: 'colo',
      status: 'operational',
      location: { lng: -90.0, lat: 35.0 },
      it_load_mw: 80,
      total_mw: null,
      confidence: 'medium' as const,
      sources: [],
      estimate: null,
    };

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: '1',
          generated_at: new Date().toISOString(),
          facilities_url: 'facilities-xyz.json.gz',
          facility_count: 1,
          methodology_version: '2026-05-v1',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ facilities: [mockFacility] }),
      } as Response);

    const { loadFacilities } = await import('./load-facilities');
    const facilities = await loadFacilities();

    expect(facilities[0]?.mw).toBe(80); // it_load_mw fallback
    expect(facilities[0]?.source_url).toBe(''); // empty sources → empty string

    fetchSpy.mockRestore();
  });
});
