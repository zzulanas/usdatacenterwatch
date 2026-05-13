import { useEffect, useRef } from 'react';
import maplibregl, { type IControl as MaplibreIControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { type PickingInfo } from '@deck.gl/core';
import { SEED_FACILITIES, facilityRadius, type Facility } from '@/data/facilities';

// TODO USD-9: swap to self-hosted PMTiles (Protomaps) once the R2 tile pipeline is wired.
// Protomaps hosted CDN requires a key with allowed origins; using demotiles as a safe dev fallback.
const BASEMAP_STYLE = 'https://demotiles.maplibre.org/style.json';

// Accent color: neutral teal (#4fd1c5 at 70% opacity)
const ACCENT_RGBA: [number, number, number, number] = [79, 209, 197, 179]; // ~0.7 opacity
const ACCENT_STROKE: [number, number, number, number] = [79, 209, 197, 230];

function buildTooltip(info: PickingInfo): { html: string; style: object } | null {
  if (!info.object) return null;
  const f = info.object as Facility;
  return {
    html: `
      <div class="tooltip-inner">
        <p class="tooltip-name">${f.name}</p>
        <p class="tooltip-operator">${f.operator}</p>
        <p class="tooltip-mw"><span class="tooltip-mw-num">${f.mw.toLocaleString()}</span> MW</p>
        <a class="tooltip-source" href="${f.source_url}" target="_blank" rel="noopener noreferrer">Source ↗</a>
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
    },
  };
}

function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-96, 39],
      zoom: 4,
      // Cap device pixel ratio at 2 for performance
      pixelRatio: Math.min(window.devicePixelRatio ?? 1, 2),
      attributionControl: { compact: true },
    });

    mapRef.current = map;

    const layer = new ScatterplotLayer<Facility>({
      id: 'facilities',
      data: SEED_FACILITIES,
      getPosition: (f) => [f.lng, f.lat],
      getRadius: (f) => facilityRadius(f.mw),
      getFillColor: ACCENT_RGBA,
      getLineColor: ACCENT_STROKE,
      stroked: true,
      lineWidthMinPixels: 1,
      radiusMinPixels: 4,
      opacity: 0.7,
      pickable: true,
    });

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [layer],
      getTooltip: buildTooltip,
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
    };
  }, []);

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
