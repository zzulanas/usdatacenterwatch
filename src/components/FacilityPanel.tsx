import { useEffect } from 'react';
import type { FacilityForMap } from '@/lib/load-facilities';
import { CONFIDENCE_STYLES, statusPillStyle, statusLabel } from '@/lib/pills';
import { formatGwh, formatGallons, formatCapex, facilityIssueLink } from '@/lib/format';

// ---------------------------------------------------------------------------
// Source type — mirrors the R2 shape. FacilityForMap has [key: string]: unknown
// for forward compat so we cast when reading sources.
// ---------------------------------------------------------------------------
interface FacilitySource {
  url: string;
  accessed_at: string;
  supports: string[];
}

// ---------------------------------------------------------------------------
// Inline pill helpers — return React-style style objects (Record<string, string>)
// We reuse confidencePillStyle / statusPillStyle from pills.ts for the Astro
// pages; for React inline styles we need the same values with correct typing.
// ---------------------------------------------------------------------------

function ConfidencePill({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const s = CONFIDENCE_STYLES[confidence];
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '10px',
        fontWeight: '600',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.04em',
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
        padding: '1px 6px',
        borderRadius: '9999px',
        verticalAlign: 'middle',
        marginLeft: '6px',
      }}
    >
      <span style={{ opacity: 0.7, fontWeight: 500 }}>confidence:</span> {confidence}
    </span>
  );
}

function StatusPill({ status }: { status: string | undefined }) {
  const style = statusPillStyle(status as Parameters<typeof statusPillStyle>[0]);
  if (!style) return null;
  const label = statusLabel(status as Parameters<typeof statusLabel>[0]);
  return (
    <span
      style={{
        ...style,
        display: 'inline-block',
        fontSize: '10px',
        verticalAlign: 'middle',
        marginLeft: '6px',
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FacilityPanel
// ---------------------------------------------------------------------------

interface FacilityPanelProps {
  facility: FacilityForMap | null;
  onClose: () => void;
}

/**
 * Side panel that renders facility detail in response to a map dot click.
 *
 * Desktop: slides in from the right at 420px wide.
 * Mobile: renders as a bottom sheet, max-height 80vh.
 *
 * Close affordances: × button, ESC key.
 * Click-outside: NOT implemented — the panel only closes via × or ESC. The map
 * canvas sits behind the panel; forwarding clicks through the overlay would
 * re-trigger the pick logic on the same dot (reopening the panel), so we opt for
 * explicit close. A future improvement could check if the click target is
 * specifically the map background (not another dot) before closing.
 */
export function FacilityPanel({ facility, onClose }: FacilityPanelProps) {
  // ESC key closes the panel
  useEffect(() => {
    if (!facility) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [facility, onClose]);

  if (!facility) return null;

  // Cast the unknown remainder fields from R2 to known shapes.
  // FacilityForMap has [key: string]: unknown via its index signature on
  // FacilityFromR2 — the cast through unknown is required by TS strict.
  const facilityUnknown = facility as unknown as Record<string, unknown>;
  const sources = Array.isArray(facilityUnknown.sources)
    ? (facilityUnknown.sources as FacilitySource[])
    : [];

  const estimate = facility.estimate ?? null;

  // Derived display values
  const mwDisplay =
    facility.mw != null && facility.mw > 0 ? facility.mw.toLocaleString('en-US') : '—';

  const gwhDisplay = estimate ? formatGwh(estimate.annual_gwh) : '—';
  const gwhRange =
    estimate != null
      ? `${formatGwh(estimate.annual_gwh_low)}–${formatGwh(estimate.annual_gwh_high)}`
      : null;

  const gallonsDisplay = estimate ? formatGallons(estimate.annual_gallons) : '—';
  const gallonsRange =
    estimate != null
      ? `${formatGallons(estimate.annual_gallons_low)}–${formatGallons(estimate.annual_gallons_high)}`
      : null;

  // Access optional fields that come through as unknown from R2.
  // We reuse the facilityUnknown cast above rather than re-casting.
  const f = facilityUnknown;
  const acres = typeof f.acres === 'number' ? f.acres : null;
  const sqft = typeof f.sqft === 'number' ? f.sqft : null;
  const it_load_mw = typeof f.it_load_mw === 'number' ? f.it_load_mw : null;
  const total_mw = typeof f.total_mw === 'number' ? f.total_mw : null;
  const design_pue = typeof f.design_pue === 'number' ? f.design_pue : null;
  const year_built = typeof f.year_built === 'number' ? f.year_built : null;
  const cooling_type = typeof f.cooling_type === 'string' ? f.cooling_type : null;
  const water_source = typeof f.water_source === 'string' ? f.water_source : null;
  const jobs_construction = typeof f.jobs_construction === 'number' ? f.jobs_construction : null;
  const jobs_permanent = typeof f.jobs_permanent === 'number' ? f.jobs_permanent : null;
  const construction_capex_usd =
    typeof f.construction_capex_usd === 'number' ? f.construction_capex_usd : null;
  const reported_annual_mwh =
    typeof f.reported_annual_mwh === 'number' ? f.reported_annual_mwh : null;
  const reported_annual_mwh_year =
    typeof f.reported_annual_mwh_year === 'number' ? f.reported_annual_mwh_year : null;
  const address = typeof f.address === 'string' ? f.address : null;
  const city = typeof f.city === 'string' ? f.city : null;
  const state = typeof f.state === 'string' ? f.state : null;
  const county = typeof f.county === 'string' ? f.county : null;
  const last_verified = typeof f.last_verified === 'string' ? f.last_verified : null;
  const tenants = Array.isArray(f.tenants) ? (f.tenants as string[]) : null;

  const locationLine = [address, city && state ? `${city}, ${state}` : (city ?? state)]
    .filter(Boolean)
    .join(' · ');

  const issueLink = facilityIssueLink(facility.slug, facility.name);
  const detailHref = `/facility/${facility.slug}`;

  function fmt(n: number, decimals = 0): string {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return (
    <>
      {/*
        Desktop: fixed right panel, slides in from right.
        Mobile: fixed bottom sheet, slides up from bottom.
        The outer wrapper is a transparent full-screen overlay only on mobile,
        to catch accidental taps outside the sheet — on desktop we skip this
        because the map must remain fully interactive.
      */}

      {/* Desktop panel — hidden on small screens */}
      <div
        data-testid="facility-panel"
        className="hidden md:flex md:flex-col fixed top-0 right-0 h-full md:w-[420px] bg-neutral-950 border-l border-neutral-800 z-20 overflow-y-auto"
        style={{
          transform: 'translateX(0)',
          transition: 'transform 0.25s ease-out',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
        }}
      >
        <PanelContent
          facility={facility}
          sources={sources}
          mwDisplay={mwDisplay}
          gwhDisplay={gwhDisplay}
          gwhRange={gwhRange}
          gallonsDisplay={gallonsDisplay}
          gallonsRange={gallonsRange}
          acres={acres}
          sqft={sqft}
          it_load_mw={it_load_mw}
          total_mw={total_mw}
          design_pue={design_pue}
          year_built={year_built}
          cooling_type={cooling_type}
          water_source={water_source}
          jobs_construction={jobs_construction}
          jobs_permanent={jobs_permanent}
          construction_capex_usd={construction_capex_usd}
          reported_annual_mwh={reported_annual_mwh}
          reported_annual_mwh_year={reported_annual_mwh_year}
          county={county}
          tenants={tenants}
          last_verified={last_verified}
          locationLine={locationLine}
          issueLink={issueLink}
          detailHref={detailHref}
          fmt={fmt}
          onClose={onClose}
          confidence={facility.confidence}
          status={facility.status}
        />
      </div>

      {/* Mobile bottom sheet */}
      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-20 flex flex-col bg-neutral-950 border-t border-neutral-800 rounded-t-lg"
        style={{
          maxHeight: '80vh',
          overflow: 'hidden',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
          transform: 'translateY(0)',
          transition: 'transform 0.25s ease-out',
        }}
      >
        <PanelContent
          facility={facility}
          sources={sources}
          mwDisplay={mwDisplay}
          gwhDisplay={gwhDisplay}
          gwhRange={gwhRange}
          gallonsDisplay={gallonsDisplay}
          gallonsRange={gallonsRange}
          acres={acres}
          sqft={sqft}
          it_load_mw={it_load_mw}
          total_mw={total_mw}
          design_pue={design_pue}
          year_built={year_built}
          cooling_type={cooling_type}
          water_source={water_source}
          jobs_construction={jobs_construction}
          jobs_permanent={jobs_permanent}
          construction_capex_usd={construction_capex_usd}
          reported_annual_mwh={reported_annual_mwh}
          reported_annual_mwh_year={reported_annual_mwh_year}
          county={county}
          tenants={tenants}
          last_verified={last_verified}
          locationLine={locationLine}
          issueLink={issueLink}
          detailHref={detailHref}
          fmt={fmt}
          onClose={onClose}
          confidence={facility.confidence}
          status={facility.status}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// PanelContent — shared inner layout for both desktop and mobile variants
// ---------------------------------------------------------------------------

interface PanelContentProps {
  facility: FacilityForMap;
  sources: FacilitySource[];
  mwDisplay: string;
  gwhDisplay: string;
  gwhRange: string | null;
  gallonsDisplay: string;
  gallonsRange: string | null;
  acres: number | null;
  sqft: number | null;
  it_load_mw: number | null;
  total_mw: number | null;
  design_pue: number | null;
  year_built: number | null;
  cooling_type: string | null;
  water_source: string | null;
  jobs_construction: number | null;
  jobs_permanent: number | null;
  construction_capex_usd: number | null;
  reported_annual_mwh: number | null;
  reported_annual_mwh_year: number | null;
  // address/city/state are folded into `locationLine` by the parent — keep
  // only `county` on the props for the at-a-glance row.
  county: string | null;
  tenants: string[] | null;
  last_verified: string | null;
  locationLine: string;
  issueLink: string;
  detailHref: string;
  fmt: (n: number, decimals?: number) => string;
  onClose: () => void;
  confidence: 'high' | 'medium' | 'low';
  status: string | undefined;
}

function PanelContent({
  facility,
  sources,
  mwDisplay,
  gwhDisplay,
  gwhRange,
  gallonsDisplay,
  gallonsRange,
  acres,
  sqft,
  it_load_mw,
  total_mw,
  design_pue,
  year_built,
  cooling_type,
  water_source,
  jobs_construction,
  jobs_permanent,
  construction_capex_usd,
  reported_annual_mwh,
  reported_annual_mwh_year,
  county,
  tenants,
  last_verified,
  locationLine,
  issueLink,
  detailHref,
  fmt,
  onClose,
  confidence,
  status,
}: PanelContentProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-neutral-800 flex-shrink-0">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-neutral-100 leading-snug">
            {facility.name}
            <StatusPill status={status} />
          </h2>
          <p className="mt-0.5 text-sm text-neutral-400">
            {facility.operator}
            <ConfidencePill confidence={confidence} />
          </p>
          {locationLine && (
            <p className="mt-1 text-xs text-neutral-500 font-mono truncate">{locationLine}</p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
        >
          ×
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Big-numbers row                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-2 px-5 py-4 border-b border-neutral-800 flex-shrink-0">
        {/* MW */}
        <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
          <p className="text-xs text-neutral-500 uppercase font-mono tracking-wide">IT Load</p>
          <p className="mt-0.5 text-xl font-semibold text-neutral-100 font-mono">{mwDisplay}</p>
          <p className="text-xs text-neutral-500">MW</p>
        </div>

        {/* GWh/yr */}
        <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
          <p className="text-xs text-neutral-500 uppercase font-mono tracking-wide">Electricity</p>
          <p
            className={`mt-0.5 text-xl font-semibold font-mono ${gwhDisplay === '—' ? 'text-neutral-600' : 'text-neutral-100'}`}
          >
            {gwhDisplay}
          </p>
          <p className="text-xs text-neutral-500">
            GWh/yr{gwhDisplay !== '—' && <span className="text-neutral-600"> (modeled)</span>}
          </p>
          {gwhRange && <p className="text-xs text-neutral-600 mt-0.5">{gwhRange}</p>}
        </div>

        {/* Gallons/yr */}
        <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
          <p className="text-xs text-neutral-500 uppercase font-mono tracking-wide">Water</p>
          <p
            className={`mt-0.5 text-xl font-semibold font-mono ${gallonsDisplay === '—' ? 'text-neutral-600' : 'text-neutral-100'}`}
          >
            {gallonsDisplay}
          </p>
          <p className="text-xs text-neutral-500">
            gal/yr{gallonsDisplay !== '—' && <span className="text-neutral-600"> (modeled)</span>}
          </p>
          {gallonsRange && <p className="text-xs text-neutral-600 mt-0.5">{gallonsRange}</p>}
        </div>

        {/* Site */}
        {acres != null ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
            <p className="text-xs text-neutral-500 uppercase font-mono tracking-wide">Site</p>
            <p className="mt-0.5 text-xl font-semibold text-neutral-100 font-mono">{fmt(acres)}</p>
            <p className="text-xs text-neutral-500">acres</p>
            {sqft != null && <p className="text-xs text-neutral-600 mt-0.5">{fmt(sqft)} sqft</p>}
          </div>
        ) : sqft != null ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
            <p className="text-xs text-neutral-500 uppercase font-mono tracking-wide">Floor area</p>
            <p className="mt-0.5 text-xl font-semibold text-neutral-100 font-mono">{fmt(sqft)}</p>
            <p className="text-xs text-neutral-500">sqft</p>
          </div>
        ) : (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
            <p className="text-xs text-neutral-500 uppercase font-mono tracking-wide">Site</p>
            <p className="mt-0.5 text-xl font-semibold text-neutral-600 font-mono">—</p>
            <p className="text-xs text-neutral-600">acres</p>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* At-a-glance key-value list                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="px-5 py-4 border-b border-neutral-800 flex-shrink-0">
        <h3 className="text-sm font-semibold text-neutral-100 mb-2">At a glance</h3>
        <dl className="divide-y divide-neutral-800 text-xs">
          {facility.tenant_type && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Type</dt>
              <dd className="text-neutral-100 capitalize">
                {facility.tenant_type.replace('_', ' ')}
              </dd>
            </div>
          )}
          {status && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Status</dt>
              <dd className="text-neutral-100">
                {statusLabel(status as Parameters<typeof statusLabel>[0])}
              </dd>
            </div>
          )}
          {cooling_type && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Cooling type</dt>
              <dd className="text-neutral-100 capitalize">{cooling_type}</dd>
            </div>
          )}
          {water_source && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Water source</dt>
              <dd className="text-neutral-100 capitalize">{water_source}</dd>
            </div>
          )}
          {year_built != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Year built</dt>
              <dd className="text-neutral-100 font-mono">{year_built}</dd>
            </div>
          )}
          {it_load_mw != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">IT load</dt>
              <dd className="text-neutral-100 font-mono">{fmt(it_load_mw)} MW</dd>
            </div>
          )}
          {total_mw != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Total capacity</dt>
              <dd className="text-neutral-100 font-mono">{fmt(total_mw)} MW</dd>
            </div>
          )}
          {design_pue != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Design PUE</dt>
              <dd className="text-neutral-100 font-mono">{design_pue.toFixed(2)}</dd>
            </div>
          )}
          {tenants && tenants.length > 0 && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Tenants</dt>
              <dd className="text-neutral-100">{tenants.join(', ')}</dd>
            </div>
          )}
          {jobs_construction != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Construction jobs</dt>
              <dd className="text-neutral-100 font-mono">{fmt(jobs_construction)}</dd>
            </div>
          )}
          {jobs_permanent != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Permanent jobs</dt>
              <dd className="text-neutral-100 font-mono">{fmt(jobs_permanent)}</dd>
            </div>
          )}
          {construction_capex_usd != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Construction capex</dt>
              <dd className="text-neutral-100 font-mono">{formatCapex(construction_capex_usd)}</dd>
            </div>
          )}
          {reported_annual_mwh != null && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">
                Operator-disclosed electricity
                {reported_annual_mwh_year ? ` (${reported_annual_mwh_year})` : ''}
              </dt>
              <dd className="text-neutral-100 font-mono">{fmt(reported_annual_mwh)} MWh/yr</dd>
            </div>
          )}
          {county && (
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">County</dt>
              <dd className="text-neutral-100">{county}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Sources                                                              */}
      {/* ------------------------------------------------------------------ */}
      {sources.length > 0 && (
        <div className="px-5 py-4 border-b border-neutral-800 flex-shrink-0">
          <h3 className="text-sm font-semibold text-neutral-100 mb-2">Sources</h3>
          <ul className="space-y-2 text-xs">
            {sources.map((source, i) => (
              <li key={i} className="border border-neutral-800 rounded-md px-3 py-2 bg-neutral-900">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-300 underline decoration-dotted hover:text-neutral-100 break-all"
                >
                  {source.url}
                </a>
                <p className="text-neutral-600 mt-0.5">Accessed {source.accessed_at}</p>
                {source.supports.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {source.supports.map((field) => (
                      <span
                        key={field}
                        className="inline-block font-mono bg-neutral-800 border border-neutral-700 text-neutral-400 px-1.5 py-0.5 rounded text-xs"
                      >
                        {field}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* Methodology footnote — mirrors the disclaimer on the
              standalone detail page so a user encountering modeled values
              in the panel gets the same provenance context. */}
          <div className="mt-3 text-xs text-neutral-500 space-y-1">
            <p>
              Energy and water figures are modeled estimates — see the{' '}
              <a href="/methodology" className="underline decoration-dotted hover:text-neutral-300">
                methodology page
              </a>{' '}
              for the formula, assumptions, and uncertainty ranges.
            </p>
            {facility.confidence === 'low' && (
              <p>
                This record is marked <strong className="text-neutral-400">low confidence</strong> —
                it was auto-imported from OpenStreetMap and has not yet been independently verified.
                Fields like IT load, acreage, and year built may be missing or inaccurate until a
                curator cross-checks against a primary source.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Actions + footer                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="px-5 py-4 mt-auto flex-shrink-0">
        <div className="flex flex-col gap-2">
          <a
            href={detailHref}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-neutral-800 border border-neutral-700 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-700 hover:border-neutral-500 transition-colors font-medium"
          >
            View full page →
          </a>
          <a
            href={issueLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 transition-colors"
          >
            Suggest a correction ↗
          </a>
        </div>

        {last_verified && (
          <p className="mt-3 text-xs text-neutral-600 font-mono">
            {facility.slug} · last verified {last_verified}
          </p>
        )}
      </div>
    </div>
  );
}

export default FacilityPanel;
