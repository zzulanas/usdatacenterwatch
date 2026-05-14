import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl, { type IControl as MaplibreIControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { type PickingInfo } from '@deck.gl/core';
import { facilityRadius, type Facility } from '@/data/facilities';
import { loadFacilities, type FacilityForMap } from '@/lib/load-facilities';
import { CONFIDENCE_STYLES } from '@/lib/pills';
import { facilityIssueLink } from '@/lib/format';
import { FacilityPanel } from '@/components/FacilityPanel';

// Carto Dark Matter: free basemap with state lines, county lines, roads, and place labels.
// Dark-themed — matches our civic/journalistic aesthetic. Attribution required per Carto TOS.
// M2 upgrade: self-hosted PMTiles on R2 (see Linear USD-9) removes the external CDN dependency.
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Continental US bounding box with ~5° padding so users can't pan to Africa or the Pacific.
// Alaska and Hawaii are outside this box (v1 data is continental only).
const US_BOUNDS: [[number, number], [number, number]] = [
  [-130, 22], // SW: past California / south of Florida
  [-65, 52], // NE: past Maine / north of Minnesota
];

// Status-aware dot styling. Operational sites use the canonical teal; planned
// facilities get visually distinct treatments so users can tell active scale
// from pipeline scale at a glance.
//
//   operational         — teal filled (#4fd1c5)
//   under_construction  — amber filled (#f59e0b) — "active build, on its way"
//   announced           — gray outline-only — "not yet real"
//   decommissioned      — dim red dashed (rare; v1 has none)
//
// Returned as a tuple { fill, stroke, opacity } so the deck.gl ScatterplotLayer
// can drive each prop from a single function call per facility.
type Rgba = [number, number, number, number];
interface DotStyle {
  fill: Rgba;
  stroke: Rgba;
  /** When false, the dot draws as outline-only (announced facilities) */
  filled: boolean;
}

const STATUS_STYLES: Record<string, DotStyle> = {
  operational: {
    fill: [79, 209, 197, 179], // teal at ~0.7 opacity
    stroke: [79, 209, 197, 230],
    filled: true,
  },
  under_construction: {
    fill: [245, 158, 11, 179], // amber at ~0.7 opacity
    stroke: [245, 158, 11, 230],
    filled: true,
  },
  announced: {
    fill: [0, 0, 0, 0], // transparent — outline-only
    stroke: [156, 163, 175, 220], // neutral-400, more visible because it's the only mark
    filled: false,
  },
  decommissioned: {
    fill: [185, 28, 28, 102], // dim red at ~0.4 opacity
    stroke: [185, 28, 28, 200],
    filled: true,
  },
};

function styleForStatus(status: string | undefined): DotStyle {
  return STATUS_STYLES[status ?? 'operational'] ?? STATUS_STYLES.operational!;
}

// Friendly labels used in the tooltip status pill
const STATUS_LABELS: Record<string, string> = {
  operational: 'operational',
  under_construction: 'under construction',
  announced: 'announced',
  decommissioned: 'decommissioned',
};

/**
 * Touch-vs-pointer affordance split:
 *
 * The deck.gl tooltip is hover-only on desktop and auto-dismisses when the
 * cursor leaves the picked object. That makes any <a> tag inside unreachable
 * with a mouse — so on pointer devices the tooltip shows informational text
 * and the dot's onClick handler opens the side panel.
 *
 * On touch devices there is no hover: a tap shows the tooltip AND the tooltip
 * stays "pinned" until the next tap moves the pick off the object. That makes
 * a live <a> link inside the tooltip the better UX for touch users; however,
 * we also open the panel on tap because a tap fires onClick on deck.gl. Both
 * the panel open and the pinned tooltip fire — the panel wins visually since
 * it sits on top of the map at z-20.
 *
 * We pick once per session by sniffing CSS hover capability + touch presence.
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const hoverNone = window.matchMedia?.('(hover: none)').matches ?? false;
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  return hoverNone || hasTouch;
}

// CONFIDENCE_STYLES is imported from @/lib/pills — shared with the facility detail page.
// The inline-style approach avoids coupling tooltip HTML to the Tailwind layer.

// issueLinkFor is now provided by facilityIssueLink from @/lib/format.
// Kept as a thin wrapper so the tooltip code below reads naturally.
function issueLinkFor(f: Facility): string {
  return facilityIssueLink(f.slug, f.name);
}

// Status pill uses the same dot color palette so the two affordances visually
// reinforce each other. Operational doesn't render a pill (it's the default).
function statusPillHtml(status: string | undefined): string {
  if (!status || status === 'operational') return '';
  const label = STATUS_LABELS[status] ?? status;
  // Borrow the dot stroke color for the pill outline; readable on dark bg.
  const s = styleForStatus(status);
  const rgba = (c: Rgba) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
  const borderColor = rgba(s.stroke);
  const fgColor = rgba(s.stroke);
  return `<span class="tooltip-status" style="display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;background:transparent;border:1px solid ${borderColor};color:${fgColor};padding:1px 6px;border-radius:9999px;margin-left:6px;vertical-align:middle;">${label}</span>`;
}

function buildTooltip(info: PickingInfo, isTouch: boolean): { html: string; style: object } | null {
  if (!info.object) return null;
  const f = info.object as Facility;

  const conf = CONFIDENCE_STYLES[f.confidence];
  // Pill includes the "confidence:" label inline so "high"/"medium"/"low" isn't
  // ambiguous out of context. The label is rendered dimmer than the value so
  // the user's eye still lands on the rating itself.
  const confidencePill = `<span class="tooltip-confidence" style="display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;background:${conf.bg};border:1px solid ${conf.border};color:${conf.fg};padding:1px 6px;border-radius:9999px;margin-left:6px;vertical-align:middle;"><span style="opacity:0.7;font-weight:500;">confidence:</span> ${f.confidence}</span>`;
  const statusPill = statusPillHtml(f.status);

  // Detail-page link: on touch, the tooltip carries a real <a> the user can
  // tap (deck.gl pins the tooltip after tap, so an inline anchor is
  // reachable). On desktop, the dot's onClick opens the side panel — we just
  // render an affordance hint here.
  const detailLine = isTouch
    ? `<a class="tooltip-detail" href="/facility/${f.slug}" style="color:#4fd1c5;font-weight:600;text-decoration:none;">View details →</a>`
    : `<p class="tooltip-detail" style="color:#4fd1c5;font-weight:600;">Click for details →</p>`;

  // Source URL link (secondary affordance — the primary action is now the
  // detail page above). Render only on touch where the user can actually
  // reach the anchor.
  const sourceLine =
    isTouch && f.source_url
      ? `<a class="tooltip-source" href="${f.source_url}" target="_blank" rel="noopener noreferrer" style="color:#9ca3af;font-size:11px;text-decoration:underline;text-decoration-style:dotted;">Source ↗</a>`
      : '';

  // Mobile-only: a direct "report data issue" link, pre-filled with the
  // facility slug + name. Desktop users get this affordance via the panel.
  const issueLine = isTouch
    ? `<a class="tooltip-issue" href="${issueLinkFor(f)}" target="_blank" rel="noopener noreferrer" style="color:#9ca3af;font-size:11px;text-decoration:underline;text-decoration-style:dotted;">Report data issue ↗</a>`
    : '';

  return {
    html: `
      <div class="tooltip-inner">
        <p class="tooltip-name">${f.name}${confidencePill}${statusPill}</p>
        <p class="tooltip-operator">${f.operator}</p>
        <p class="tooltip-mw"><span class="tooltip-mw-num">${f.mw.toLocaleString()}</span> MW</p>
        ${detailLine}
        ${sourceLine}
        ${issueLine}
      </div>
    `,
    style: {
      backgroundColor: '#111827',
      border: '1px solid #374151',
      borderRadius: '6px',
      padding: '10px 14px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
      color: '#f3f4f6',
      maxWidth: '240px',
      lineHeight: '1.6',
      // Touch: tooltip becomes interactive so the <a> links capture taps.
      // Pointer: keep deck.gl's default (none) so the tooltip can't eat hover
      // events from neighboring dots.
      ...(isTouch ? { pointerEvents: 'auto' } : {}),
    },
  };
}

function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [facilities, setFacilities] = useState<FacilityForMap[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<FacilityForMap | null>(null);

  // selectedFacilityRef keeps the deck.gl onClick callback in sync without
  // requiring the layer to be rebuilt on each selection change.
  const selectedFacilityRef = useRef<FacilityForMap | null>(null);
  selectedFacilityRef.current = selectedFacility;

  // facilitiesRef keeps the popstate handler in sync with loaded facilities.
  const facilitiesRef = useRef<FacilityForMap[]>([]);
  facilitiesRef.current = facilities;

  // Open a facility panel: set state, push URL, fly map to location.
  const openPanel = useCallback((f: FacilityForMap) => {
    setSelectedFacility(f);
    window.history.pushState({ slug: f.slug }, '', `/?f=${f.slug}`);
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [f.lng, f.lat], zoom: 9, duration: 1000 });
    }
  }, []);

  // Close the panel: clear state, revert URL.
  const closePanel = useCallback(() => {
    setSelectedFacility(null);
    window.history.pushState({}, '', '/');
  }, []);

  // Load facilities from R2 (or fall back to seed data) on mount.
  // `cancelled` guards against setState after unmount if the user navigates
  // away mid-fetch — the promise will resolve into a no-op instead.
  useEffect(() => {
    let cancelled = false;
    loadFacilities()
      .then((data) => {
        if (!cancelled) setFacilities(data);
      })
      .catch(() => {
        // loadFacilities always resolves; this catch is a safety net
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // On mount: read ?f=slug from URL and pre-open the panel if present.
  // This runs once; openPanel calls flyTo which needs the map to be ready,
  // so we defer via a small loop until mapRef is populated.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('f');
    if (!slug) return;

    // Poll until both map and facilities are ready (map init is async).
    let attempts = 0;
    const maxAttempts = 40; // 4s at 100ms polling
    const poll = setInterval(() => {
      attempts++;
      const facs = facilitiesRef.current;
      const map = mapRef.current;
      if (facs.length > 0 && map) {
        clearInterval(poll);
        const target = facs.find((f) => f.slug === slug);
        if (target) {
          setSelectedFacility(target);
          map.flyTo({ center: [target.lng, target.lat], zoom: 9, duration: 1000 });
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
      }
    }, 100);

    return () => clearInterval(poll);
  }, []);

  // Browser back/forward: sync panel state with the history entry.
  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      const state = e.state as { slug?: string } | null;
      if (state?.slug) {
        const target = facilitiesRef.current.find((f) => f.slug === state.slug);
        if (target) {
          setSelectedFacility(target);
          if (mapRef.current) {
            mapRef.current.flyTo({ center: [target.lng, target.lat], zoom: 9, duration: 600 });
          }
        }
      } else {
        setSelectedFacility(null);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Detected once at mount; affects both tooltip rendering and onClick wiring.
  // Stored in a ref so the deck.gl callbacks see the same value across re-renders.
  const isTouchRef = useRef<boolean>(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    isTouchRef.current = isTouchDevice();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-96, 39],
      zoom: 4,
      // Cap device pixel ratio at 2 for performance
      pixelRatio: Math.min(window.devicePixelRatio ?? 1, 2),
      attributionControl: { compact: true },
      // Constrain panning to the continental US — our v1 data is continental only.
      maxBounds: US_BOUNDS,
    });

    mapRef.current = map;
    // Expose for Playwright E2E tests (window.__map is stripped by the browser on production
    // builds the same way any dev helper would be — acceptable for a civic open-source site).
    (window as unknown as Record<string, unknown>).__map = map;

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: (info) => buildTooltip(info, isTouchRef.current),
      // Pointer-cursor on facility hover signals the dot is clickable on
      // desktop. Mobile browsers ignore cursor entirely — but deck.gl REQUIRES
      // a function here (passing `undefined` throws `getCursor is not a
      // function` during render and nukes the entire layer stack, which is
      // why mobile dots disappeared in #26). Returning 'grab' on touch is a
      // harmless no-op that keeps deck.gl happy.
      getCursor: ({ isDragging, isHovering }) =>
        isDragging ? 'grabbing' : isHovering && !isTouchRef.current ? 'pointer' : 'grab',
      useDevicePixels: Math.min(window.devicePixelRatio ?? 1, 2),
    });

    overlayRef.current = overlay;

    // Log non-fatal tile errors without crashing the map
    map.on('error', (e) => {
      // Suppress tile 404s — common during dev when some tiles aren't cached
      const msg = (e as { error?: { message?: string } })?.error?.message ?? '';
      if (!msg.includes('404') && !msg.includes('tile')) {
        console.warn('USD-10 map error:', e);
      }
    });

    // deck.gl v9 MapboxOverlay vs. maplibre-gl v5 IControl: type signatures
    // diverge (Mapbox-only fields). Runtime is verified; cast is the
    // upstream-recommended workaround. Re-evaluate when @deck.gl/mapbox ships
    // maplibre-aware types.
    map.addControl(overlay as unknown as MaplibreIControl);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    return () => {
      overlayRef.current?.finalize();
      mapRef.current?.remove();
      mapRef.current = null;
      overlayRef.current = null;
      delete (window as unknown as Record<string, unknown>).__map;
    };
  }, []);

  // Update the deck.gl layer whenever facilities data changes.
  // openPanel is stable (useCallback with no deps), so including it here
  // doesn't cause unnecessary layer rebuilds.
  useEffect(() => {
    if (!overlayRef.current) return;

    const layer = new ScatterplotLayer<Facility>({
      id: 'facilities',
      data: facilities as Facility[],
      getPosition: (f) => [f.lng, f.lat],
      getRadius: (f) => facilityRadius(f.mw),
      // Status drives the dot styling: operational=teal filled, under_construction=
      // amber filled, announced=gray outline-only, decommissioned=dim red dashed.
      // See STATUS_STYLES at the top of the file for the full palette.
      getFillColor: (f) => styleForStatus(f.status).fill,
      getLineColor: (f) => styleForStatus(f.status).stroke,
      stroked: true,
      // Bump line width on outline-only (announced) dots so they read as
      // present-but-not-yet-real at continental zoom.
      getLineWidth: (f) => (styleForStatus(f.status).filled ? 1 : 2),
      lineWidthMinPixels: 1,
      // Floor in pixels so facilities with no public IT load (mw=0 in the
      // normalizer) still render as a clickable dot at continental zoom.
      // The sqrt(mw)*1500 scale takes over for facilities with sourced load.
      radiusMinPixels: 8,
      opacity: 0.7,
      pickable: true,
      // Both desktop and touch: clicking/tapping a dot opens the side panel.
      // On touch, the tooltip also pins — the panel sits at z-20 and wins
      // visually. The "View details →" link in the tooltip gives touch users
      // an alternative navigation path to the standalone detail page.
      onClick: ({ object }) => {
        const f = object as FacilityForMap | undefined;
        if (!f?.slug) return;
        openPanel(f);
      },
    });

    overlayRef.current.setProps({ layers: [layer] });
  }, [facilities, openPanel]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        data-testid="map-view"
        aria-label="US Data Center Map"
      />
      <FacilityPanel facility={selectedFacility} onClose={closePanel} />
    </div>
  );
}

export default MapView;
