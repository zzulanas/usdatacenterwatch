/**
 * filterStore.ts — Zustand store for filter sidebar state (USD-18).
 *
 * Client-only. Do NOT import from Astro frontmatter or scripts/ — this module
 * is consumed by the MapView / MapFilters islands (`client:only="react"`).
 *
 * State held:
 *   - facilities: the loaded dataset (MapView pushes after loadFacilities())
 *   - filters: current FilterState
 *   - facets: derived options (recomputed when facilities change)
 *   - panelOpen, filterSheetOpen: mobile coexistence flags (only one bottom
 *     sheet visible at a time)
 *
 * The store does NOT touch window at module scope — URL hydration only fires
 * inside the `hydrateFromUrl` action, called once from MapFilters on mount.
 */

import { create } from 'zustand';
import type { FacilityForMap } from '@/lib/load-facilities';
import {
  EMPTY_FILTERS,
  deriveFacetOptions,
  applyFilters,
  parseFiltersFromUrl,
  serializeFilters,
  type FilterState,
  type FacetOptions,
} from '@/lib/filters';
import { FILTER_PARAM_KEYS, patchUrl } from '@/lib/url-state';

interface FilterStoreState {
  // Data
  facilities: FacilityForMap[];
  facets: FacetOptions;
  filters: FilterState;
  /** True once initial URL hydration has run. Prevents flicker from default → URL state. */
  hydrated: boolean;

  // UI (coexistence with FacilityPanel)
  /** Mobile filter Sheet visibility. Setting this true forces facilityPanelOpen → false. */
  filterSheetOpen: boolean;
  /** Desktop sidebar visibility (collapsed by default per design). */
  desktopPanelOpen: boolean;

  // Setters
  setFacilities: (facilities: FacilityForMap[]) => void;
  setFilters: (next: FilterState) => void;
  patchFilters: (patch: Partial<FilterState>) => void;
  clearFilters: () => void;
  hydrateFromUrl: () => void;
  setFilterSheetOpen: (open: boolean) => void;
  setDesktopPanelOpen: (open: boolean) => void;
}

/**
 * Initial facets — replaced once facilities load. Using sentinel bounds keeps
 * deriveFacetOptions's branching contained to one place.
 */
const INITIAL_FACETS: FacetOptions = deriveFacetOptions([]);

export const useFilterStore = create<FilterStoreState>((set, get) => ({
  facilities: [],
  facets: INITIAL_FACETS,
  filters: EMPTY_FILTERS,
  hydrated: false,
  filterSheetOpen: false,
  desktopPanelOpen: false,

  setFacilities: (facilities) => {
    const facets = deriveFacetOptions(facilities);
    set({ facilities, facets });
    // Re-hydrate filter ranges against the new facet bounds — if URL had
    // mw=0-10000 and the data bounds are smaller, parseFiltersFromUrl clamps
    // it on the next hydrate pass. Cheap and keeps the URL and slider state
    // consistent when data swaps in.
    if (get().hydrated) {
      const params = new URLSearchParams(window.location.search);
      set({ filters: parseFiltersFromUrl(params, facets) });
    }
  },

  setFilters: (next) => {
    set({ filters: next });
    writeFiltersToUrl(next, get().facets);
  },

  patchFilters: (patch) => {
    const next: FilterState = { ...get().filters, ...patch };
    set({ filters: next });
    writeFiltersToUrl(next, get().facets);
  },

  clearFilters: () => {
    set({ filters: { ...EMPTY_FILTERS } });
    // Strip every filter key from the URL but leave panel (?f=) alone.
    const wipe: Record<string, null> = {};
    for (const k of FILTER_PARAM_KEYS) wipe[k] = null;
    patchUrl(wipe, 'replace');
  },

  hydrateFromUrl: () => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const filters = parseFiltersFromUrl(params, get().facets);
    set({ filters, hydrated: true });
  },

  setFilterSheetOpen: (open) => {
    set({ filterSheetOpen: open });
  },

  setDesktopPanelOpen: (open) => {
    set({ desktopPanelOpen: open });
  },
}));

/** Write current filter state back to the URL, preserving non-filter params. */
function writeFiltersToUrl(filters: FilterState, facets: FacetOptions): void {
  patchUrl(serializeFilters(filters, facets), 'replace');
}

/** Selector: the filtered facility list. Wrap in useMemo at the call site. */
export function selectFilteredFacilities(state: FilterStoreState): FacilityForMap[] {
  return applyFilters(state.facilities, state.filters);
}
