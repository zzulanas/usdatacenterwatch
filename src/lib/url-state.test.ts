// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { patchUrl } from './url-state';

function setLocation(href: string): void {
  // jsdom-style: replace history+location atomically via the JSDOM-exposed API.
  window.history.replaceState({}, '', href);
}

describe('patchUrl', () => {
  beforeEach(() => {
    setLocation('/');
  });

  it('sets a new param', () => {
    patchUrl({ o: 'meta' });
    expect(window.location.search).toBe('?o=meta');
  });

  it('removes a param when value is null', () => {
    setLocation('/?o=meta&f=foo');
    patchUrl({ o: null });
    expect(window.location.search).toBe('?f=foo');
  });

  it('removes a param when value is empty string', () => {
    setLocation('/?o=meta');
    patchUrl({ o: '' });
    expect(window.location.search).toBe('');
  });

  it('preserves params it is not told to change (the coexistence contract)', () => {
    setLocation('/?f=meta-prineville-or');
    patchUrl({ o: 'meta', s: 'operational' });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('f')).toBe('meta-prineville-or');
    expect(params.get('o')).toBe('meta');
    expect(params.get('s')).toBe('operational');
  });

  it('panel close (removing f) does not strip filter params', () => {
    setLocation('/?o=meta&s=operational&f=meta-prineville-or');
    patchUrl({ f: null });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('f')).toBeNull();
    expect(params.get('o')).toBe('meta');
    expect(params.get('s')).toBe('operational');
  });

  it('multiple updates apply atomically', () => {
    setLocation('/?o=old&t=hyperscaler');
    patchUrl({ o: 'meta,google', t: null, s: 'operational' });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('o')).toBe('meta,google');
    expect(params.get('t')).toBeNull();
    expect(params.get('s')).toBe('operational');
  });

  it('preserves the hash', () => {
    setLocation('/#methodology');
    patchUrl({ o: 'meta' });
    expect(window.location.hash).toBe('#methodology');
    expect(window.location.search).toBe('?o=meta');
  });

  it('push mode adds a history entry; replace mode does not', () => {
    const initialLength = window.history.length;
    patchUrl({ o: 'meta' }, 'replace');
    const afterReplace = window.history.length;
    patchUrl({ o: 'google' }, 'push');
    const afterPush = window.history.length;
    expect(afterReplace).toBe(initialLength);
    expect(afterPush).toBe(initialLength + 1);
  });
});
