/**
 * url-state.ts — single coordination point for URL query-param writes.
 *
 * Two systems write to the URL:
 *   - The facility panel (key `f`) — owned by MapView.
 *   - The filter sidebar (keys `o,t,s,mw,c,yr,st`) — owned by filterStore.
 *
 * Without a shared helper, each writer's history.replaceState wipes the
 * other's params. Concretely: opening a panel on a URL with active filters
 * used to call `replaceState({}, '', '/')` and erase every filter — silently
 * breaking the share-this-view contract. patchUrl preserves every param it
 * is not explicitly told to remove.
 */

/** Sentinel meaning "remove this key entirely" when passed to patchUrl. */
type Patch = Record<string, string | null>;

/**
 * Apply a partial patch to window.location's search params and write the
 * result back via history. Keys mapped to a non-null string are set; keys
 * mapped to null are deleted. All other existing params pass through.
 *
 * Modes:
 *   - 'replace' (default): no history entry added. Use for high-frequency
 *     writes like slider drags or chip toggles.
 *   - 'push': a new history entry is added. Use for distinct navigation
 *     events the user expects to "go back from" (e.g. opening a facility
 *     panel from the map).
 */
export function patchUrl(updates: Patch, mode: 'push' | 'replace' = 'replace'): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }

  const qs = url.searchParams.toString();
  const newUrl = url.pathname + (qs ? `?${qs}` : '') + url.hash;

  if (mode === 'push') {
    window.history.pushState({}, '', newUrl);
  } else {
    window.history.replaceState({}, '', newUrl);
  }
}

/** Keys owned by the facility-panel system. */
export const PANEL_PARAM_KEYS = ['f'] as const;

/** Keys owned by the filter system. */
export const FILTER_PARAM_KEYS = ['o', 't', 's', 'mw', 'c', 'yr', 'st'] as const;
