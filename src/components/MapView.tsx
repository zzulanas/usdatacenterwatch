import { useEffect, useRef, useState } from 'react';
import maplibregl, { type IControl as MaplibreIControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { type PickingInfo } from '@deck.gl/core';
import { facilityRadius, type Facility } from '@/data/facilities';
import { loadFacilities, type FacilityForMap } from '@/lib/load-facilities';

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

// Accent color: neutral teal (#4fd1c5 at 70% opacity)
const ACCENT_RGBA: [number, number, number, number] = [79, 209, 197, 179]; // ~0.7 opacity
const ACCENT_STROKE: [number, number, number, number] = [79, 209, 197, 230];

/**
 * Touch-vs-pointer affordance split:
 *
 * The deck.gl tooltip is hover-only on desktop and auto-dismisses when the
 * cursor leaves the picked object. That makes any <a> tag inside unreachable
 * with a mouse — so on pointer devices the tooltip shows informational text
 * and the dot's onClick handler opens the source URL.
 *
 * On touch devices there is no hover: a tap shows the tooltip AND the tooltip
 * stays "pinned" until the next tap moves the pick off the object. That makes
 * a live <a> link inside the tooltip the better UX (the dot's onClick would
 * yank the user straight to the source before they read what they tapped).
 *
 * We pick once per session by sniffing CSS hover capability + touch presence.
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const hoverNone = window.matchMedia?.('(hover: none)').matches ?? false;
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  return hoverNone || hasTouch;
}

function buildTooltip(info: PickingInfo, isTouch: boolean): { html: string; style: object } | null {
  if (!info.object) return null;
  const f = info.object as Facility;
  const sourceLine = f.source_url
    ? isTouch
      ? `<a class="tooltip-source" href="${f.source_url}" target="_blank" rel="noopener noreferrer">Source ↗</a>`
      : `<p class="tooltip-source">Click for source ↗</p>`
    : `<p class="tooltip-source">(no source URL)</p>`;
  return {
    html: `
      <div class="tooltip-inner">
        <p class="tooltip-name">${f.name}</p>
        <p class="tooltip-operator">${f.operator}</p>
        <p class="tooltip-mw"><span class="tooltip-mw-num">${f.mw.toLocaleString()}</span> MW</p>
        ${sourceLine}
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
      maxWidth: '220px',
      lineHeight: '1.6',
      // Touch: tooltip becomes interactive so the <a> link captures taps.
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
      // Pointer-cursor on facility hover signals the dot is clickable
      // (paired with the ScatterplotLayer.onClick handler below).
      // Skipped on touch — pointer cursor has no meaning on a touchscreen and
      // the click affordance there is the <a> inside the tooltip, not the dot.
      getCursor: isTouchRef.current
        ? undefined
        : ({ isDragging, isHovering }) =>
            isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
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

  // Update the deck.gl layer whenever facilities data changes
  useEffect(() => {
    if (!overlayRef.current) return;

    const layer = new ScatterplotLayer<Facility>({
      id: 'facilities',
      data: facilities as Facility[],
      getPosition: (f) => [f.lng, f.lat],
      getRadius: (f) => facilityRadius(f.mw),
      getFillColor: ACCENT_RGBA,
      getLineColor: ACCENT_STROKE,
      stroked: true,
      lineWidthMinPixels: 1,
      // Floor in pixels so facilities with no public IT load (mw=0 in the
      // normalizer) still render as a clickable dot at continental zoom.
      // The sqrt(mw)*1500 scale takes over for facilities with sourced load.
      radiusMinPixels: 8,
      opacity: 0.7,
      pickable: true,
      // Interim: on pointer devices, clicking a dot opens the cited source URL
      // in a new tab (the deck.gl tooltip auto-dismisses on mouseleave so the
      // <a> inside is unreachable with a mouse). On touch devices we leave
      // onClick unset — tapping a dot shows a pinned tooltip whose <a> link
      // captures the next tap. USD-22's side-panel + URL state replaces both.
      onClick: isTouchRef.current
        ? undefined
        : ({ object }) => {
            const f = object as Facility | undefined;
            if (!f?.source_url) return;
            window.open(f.source_url, '_blank', 'noopener,noreferrer');
          },
    });

    overlayRef.current.setProps({ layers: [layer] });
  }, [facilities]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      data-testid="map-view"
      aria-label="US Data Center Map"
    />
  );
}

export default MapView;
