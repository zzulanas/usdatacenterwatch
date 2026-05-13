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

// Visual treatment per confidence level. Emerald = operator-disclosed primary,
// amber = derived or trade-press, gray = thin/aggregator-only. Inline styles to
// avoid coupling the tooltip HTML to the project's Tailwind layer.
const CONFIDENCE_STYLES: Record<
  Facility['confidence'],
  { bg: string; border: string; fg: string }
> = {
  high: { bg: '#064e3b', border: '#10b981', fg: '#d1fae5' }, // emerald
  medium: { bg: '#78350f', border: '#f59e0b', fg: '#fef3c7' }, // amber
  low: { bg: '#374151', border: '#6b7280', fg: '#d1d5db' }, // gray
};

const REPO_NEW_ISSUE = 'https://github.com/zzulanas/usdatacenterwatch/issues/new';

function issueLinkFor(f: Facility): string {
  // Pre-fill the GH issue template with this facility's slug + name. The
  // ?template= param selects facility-correction.md; ?title= + ?body= override
  // the template defaults so curators see the right slug already filled in.
  const title = `[data]: ${f.slug}`;
  const body = [
    `**Facility slug:** \`${f.slug}\``,
    `**Facility name:** ${f.name}`,
    '',
    `**What's wrong, missing, or stale?**`,
    '',
    `**Source(s) supporting the correction:**`,
    `- URL: `,
    `- Accessed: `,
    `- Which fields it backs: `,
    '',
    `**Additional context:**`,
  ].join('\n');
  const params = new URLSearchParams({
    template: 'facility-correction.md',
    title,
    body,
  });
  return `${REPO_NEW_ISSUE}?${params.toString()}`;
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

  const sourceLine = f.source_url
    ? isTouch
      ? `<a class="tooltip-source" href="${f.source_url}" target="_blank" rel="noopener noreferrer">Source ↗</a>`
      : `<p class="tooltip-source">Click for source ↗</p>`
    : `<p class="tooltip-source">(no source URL)</p>`;

  // Mobile-only: a direct "report data issue" link, pre-filled with the
  // facility slug + name. Desktop users get this affordance from USD-22's
  // side panel (deck.gl tooltip auto-dismisses with the mouse, so an in-
  // tooltip link is unreachable with a pointer device).
  const issueLine = isTouch
    ? `<a class="tooltip-issue" href="${issueLinkFor(f)}" target="_blank" rel="noopener noreferrer" style="color:#9ca3af;font-size:11px;text-decoration:underline;text-decoration-style:dotted;">Report data issue ↗</a>`
    : '';

  return {
    html: `
      <div class="tooltip-inner">
        <p class="tooltip-name">${f.name}${confidencePill}${statusPill}</p>
        <p class="tooltip-operator">${f.operator}</p>
        <p class="tooltip-mw"><span class="tooltip-mw-num">${f.mw.toLocaleString()}</span> MW</p>
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

  // Update the deck.gl layer whenever facilities data changes
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
