/**
 * MapFilters.tsx — USD-18 filter sidebar (left-edge on desktop, bottom Sheet
 * on mobile). State + URL serialization is delegated to filterStore.ts.
 *
 * Desktop: a 280px sidebar that slides out from the left edge of the map.
 * Collapsed by default; an always-visible vertical handle on the inner edge
 * toggles open/close. Filter changes update deck.gl in real time via the
 * store's filtered selector consumed in MapView.
 *
 * Mobile: a floating "Filters" button in the bottom-left corner of the map
 * opens a bottom Sheet. Opening the Sheet does not collide with the facility
 * panel because both live above z-20 and the store-driven `panelOpen` flag
 * keeps only one open at a time.
 */

import { useEffect, useMemo, useState } from 'react';
import { Filter, X, ChevronLeft, ChevronRight } from 'lucide-react';

import { useFilterStore } from '@/stores/filterStore';
import {
  STATUS_DEFAULT,
  applyFilters,
  hasActiveFilters,
  activeFilterCount,
  type FilterState,
  type FacetOptions,
} from '@/lib/filters';
import type { CoolingType, StatusType, TenantType } from '@/lib/zod-facility-schema';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Status / type labels — friendly user-facing strings for enum values
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<StatusType, string> = {
  operational: 'Operational',
  under_construction: 'Under construction',
  announced: 'Announced',
  decommissioned: 'Decommissioned',
};

const TENANT_TYPE_LABELS: Record<TenantType, string> = {
  hyperscaler: 'Hyperscaler',
  colo: 'Colo',
  crypto: 'Crypto',
  enterprise: 'Enterprise',
};

const COOLING_LABELS: Record<CoolingType, string> = {
  air: 'Air',
  evap: 'Evap',
  liquid: 'Liquid',
  hybrid: 'Hybrid',
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export default function MapFilters() {
  const facilities = useFilterStore((s) => s.facilities);
  const filters = useFilterStore((s) => s.filters);
  const facets = useFilterStore((s) => s.facets);
  const desktopPanelOpen = useFilterStore((s) => s.desktopPanelOpen);
  const filterSheetOpen = useFilterStore((s) => s.filterSheetOpen);
  const hydrated = useFilterStore((s) => s.hydrated);
  const hydrateFromUrl = useFilterStore((s) => s.hydrateFromUrl);
  const setDesktopPanelOpen = useFilterStore((s) => s.setDesktopPanelOpen);
  const setFilterSheetOpen = useFilterStore((s) => s.setFilterSheetOpen);

  // Hydrate filter state from the URL once, after facilities (and therefore
  // facets) are available. Re-running once isn't harmful but it's wasteful —
  // gate on `!hydrated` and `facilities.length > 0`.
  useEffect(() => {
    if (!hydrated && facilities.length > 0) hydrateFromUrl();
  }, [hydrated, facilities.length, hydrateFromUrl]);

  // Recompute the filtered set whenever filters or facilities change. At ~5k
  // facilities the full predicate pass is sub-millisecond, but useMemo
  // prevents re-filtering on unrelated re-renders (panel open/close, etc).
  const filtered = useMemo(() => applyFilters(facilities, filters), [facilities, filters]);

  const total = facilities.length;
  const visible = filtered.length;

  return (
    <>
      {/* ---------- Desktop sidebar (md+) ---------- */}
      <DesktopSidebar
        open={desktopPanelOpen}
        onToggle={() => setDesktopPanelOpen(!desktopPanelOpen)}
        visible={visible}
        total={total}
      />

      {/* ---------- Mobile FAB trigger (visible md-down) ---------- */}
      <button
        type="button"
        onClick={() => setFilterSheetOpen(true)}
        data-testid="mobile-filter-fab"
        className="md:hidden fixed bottom-4 left-4 z-10 inline-flex items-center gap-2 rounded-full bg-neutral-900 border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-100 shadow-lg shadow-black/40 hover:bg-neutral-800 transition-colors"
        aria-label="Open filters"
      >
        <Filter className="h-4 w-4" />
        <span>Filters</span>
        {hasActiveFilters(filters) && (
          <Badge variant="active" className="ml-1">
            {activeFilterCount(filters)}
          </Badge>
        )}
      </button>

      {/* ---------- Mobile Sheet (visible md-down) ---------- */}
      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent
          side="bottom"
          className="md:hidden max-h-[85vh] p-0"
          data-testid="filter-sheet"
        >
          <SheetTitle className="sr-only">Filters</SheetTitle>
          <FilterPanelBody visible={visible} total={total} facets={facets} filters={filters} />
        </SheetContent>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar wrapper
// ---------------------------------------------------------------------------

interface DesktopSidebarProps {
  open: boolean;
  onToggle: () => void;
  visible: number;
  total: number;
}

function DesktopSidebar({ open, onToggle, visible, total }: DesktopSidebarProps) {
  const filters = useFilterStore((s) => s.filters);
  const facets = useFilterStore((s) => s.facets);

  return (
    <div
      className={cn(
        'hidden md:flex absolute top-0 left-0 h-full z-10',
        'transition-transform duration-200 ease-out'
      )}
      style={{
        transform: open ? 'translateX(0)' : 'translateX(-280px)',
      }}
      data-testid="desktop-filter-sidebar"
      data-open={open ? 'true' : 'false'}
    >
      <div className="w-[280px] h-full bg-neutral-950 border-r border-neutral-800 flex flex-col overflow-hidden">
        <FilterPanelBody visible={visible} total={total} facets={facets} filters={filters} />
      </div>

      {/* Edge handle — always visible. Reads as "the panel lives here". */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? 'Hide filters' : 'Show filters'}
        data-testid="desktop-filter-toggle"
        className="self-center h-20 px-1 -ml-px bg-neutral-900 border border-neutral-800 border-l-0 rounded-r-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors flex items-center justify-center"
      >
        {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {!open && hasActiveFilters(filters) && (
          <Badge variant="active" className="ml-1">
            {activeFilterCount(filters)}
          </Badge>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared panel body (used by both desktop sidebar and mobile sheet)
// ---------------------------------------------------------------------------

interface FilterPanelBodyProps {
  visible: number;
  total: number;
  facets: FacetOptions;
  filters: FilterState;
}

function FilterPanelBody({ visible, total, facets, filters }: FilterPanelBodyProps) {
  const clearFilters = useFilterStore((s) => s.clearFilters);
  const patchFilters = useFilterStore((s) => s.patchFilters);
  const setFilterSheetOpen = useFilterStore((s) => s.setFilterSheetOpen);
  const active = hasActiveFilters(filters);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-100">Filters</h2>
          {active && (
            <Badge variant="default" className="text-[10px]">
              {activeFilterCount(filters)}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {active && (
            <button
              type="button"
              onClick={clearFilters}
              data-testid="clear-filters"
              className="text-xs text-neutral-400 hover:text-neutral-100 transition-colors px-2 py-1 rounded"
            >
              Clear all
            </button>
          )}
          {/* Mobile close — only visible inside the Sheet (sheet renders md:hidden) */}
          <button
            type="button"
            onClick={() => setFilterSheetOpen(false)}
            aria-label="Close filters"
            className="md:hidden w-7 h-7 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Counter row */}
      <div className="px-4 py-2 border-b border-neutral-800 flex-shrink-0">
        <p className="text-xs text-neutral-500 font-mono">
          Showing <span className="text-neutral-100 font-semibold">{visible.toLocaleString()}</span>{' '}
          of <span className="text-neutral-300">{total.toLocaleString()}</span> facilities
        </p>
      </div>

      {/* Scrollable filter sections */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Operator (multi-select via Popover + Command) */}
        <Section title="Operator">
          <MultiSelectPopover
            label="operator"
            placeholder="Search operators…"
            options={facets.operators}
            selected={filters.operators}
            onChange={(operators) => patchFilters({ operators })}
            testId="filter-operator"
          />
        </Section>

        {/* Tenant type (chips) */}
        <Section title="Tenant type">
          <ChipGroup<TenantType>
            options={facets.tenantTypes}
            labels={TENANT_TYPE_LABELS}
            selected={filters.tenantTypes}
            onChange={(tenantTypes) => patchFilters({ tenantTypes })}
            testIdPrefix="filter-tenant"
          />
        </Section>

        {/* Status (chips). Decommissioned hidden by default. */}
        <Section
          title="Status"
          hint={
            arrayEqualsAsSet(filters.statuses, STATUS_DEFAULT)
              ? 'Default: hides decommissioned'
              : undefined
          }
        >
          <ChipGroup<StatusType>
            options={facets.statuses}
            labels={STATUS_LABELS}
            selected={filters.statuses}
            onChange={(statuses) => patchFilters({ statuses })}
            testIdPrefix="filter-status"
          />
        </Section>

        {/* MW range (slider) */}
        <Section title="IT load (MW)">
          <RangeSlider
            bounds={facets.mwBounds}
            value={filters.mwRange}
            onChange={(mwRange) => patchFilters({ mwRange })}
            format={(n) => n.toLocaleString()}
            unit="MW"
            testId="filter-mw"
          />
        </Section>

        {/* Cooling (chips) */}
        <Section title="Cooling">
          <ChipGroup<CoolingType>
            options={facets.coolingTypes}
            labels={COOLING_LABELS}
            selected={filters.coolingTypes}
            onChange={(coolingTypes) => patchFilters({ coolingTypes })}
            testIdPrefix="filter-cooling"
          />
        </Section>

        {/* Year built (slider) */}
        <Section title="Year built">
          <RangeSlider
            bounds={facets.yearBounds}
            value={filters.yearRange}
            onChange={(yearRange) => patchFilters({ yearRange })}
            format={(n) => String(n)}
            unit=""
            testId="filter-year"
          />
        </Section>

        {/* State (multi-select via Popover + Command) */}
        <Section title="State">
          <MultiSelectPopover
            label="state"
            placeholder="Search states…"
            options={facets.states}
            selected={filters.states}
            onChange={(states) => patchFilters({ states })}
            testId="filter-state"
          />
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper — common label + spacing
// ---------------------------------------------------------------------------

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <h3 className="text-[10px] font-mono uppercase tracking-wide text-neutral-500">{title}</h3>
        {hint && <span className="text-[10px] text-neutral-600 italic">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChipGroup — togglable chips for small enum filters
// ---------------------------------------------------------------------------

function ChipGroup<T extends string>({
  options,
  labels,
  selected,
  onChange,
  testIdPrefix,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onChange: (next: T[]) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => {
              const next = isActive ? selected.filter((s) => s !== opt) : [...selected, opt];
              onChange(next);
            }}
            data-testid={`${testIdPrefix}-${opt}`}
            data-active={isActive}
            aria-pressed={isActive}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
              isActive
                ? 'bg-neutral-100 border-neutral-100 text-neutral-900'
                : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100'
            )}
          >
            {labels[opt]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiSelectPopover — Popover + Command for operator / state
// ---------------------------------------------------------------------------

function MultiSelectPopover({
  label,
  placeholder,
  options,
  selected,
  onChange,
  testId,
}: {
  label: string;
  placeholder: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);

  const trigger =
    selected.length === 0
      ? `All ${label}s`
      : selected.length <= 2
        ? selected.join(', ')
        : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`${testId}-trigger`}
          className="w-full inline-flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-600 transition-colors"
        >
          <span className={cn('truncate', selected.length === 0 && 'text-neutral-500')}>
            {trigger}
          </span>
          {selected.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-neutral-700 text-neutral-100 text-[10px] font-mono w-5 h-5 flex-shrink-0">
              {selected.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        data-testid={`${testId}-popover`}
      >
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSelected = selected.includes(opt);
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      const next = isSelected
                        ? selected.filter((s) => s !== opt)
                        : [...selected, opt];
                      onChange(next);
                    }}
                    data-testid={`${testId}-option-${opt}`}
                  >
                    <Checkbox checked={isSelected} aria-label={opt} />
                    <span className="truncate">{opt}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// RangeSlider — two-thumb slider with numeric labels
// ---------------------------------------------------------------------------

function RangeSlider({
  bounds,
  value,
  onChange,
  format,
  unit,
  testId,
}: {
  bounds: [number, number];
  value: [number, number] | null;
  onChange: (next: [number, number] | null) => void;
  format: (n: number) => string;
  unit: string;
  testId: string;
}) {
  const current: [number, number] = value ?? bounds;
  // Disabled when bounds are degenerate (no usable data).
  const degenerate = bounds[0] === bounds[1];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs font-mono">
        <span className="text-neutral-100">
          {format(current[0])}
          {unit && ` ${unit}`}
        </span>
        <span className="text-neutral-500">–</span>
        <span className="text-neutral-100">
          {format(current[1])}
          {unit && ` ${unit}`}
        </span>
      </div>
      <Slider
        min={bounds[0]}
        max={bounds[1]}
        step={1}
        value={current}
        disabled={degenerate}
        onValueChange={(arr) => {
          const next: [number, number] = [arr[0] ?? bounds[0], arr[1] ?? bounds[1]];
          // Normalize back to null when slider is at full extent — keeps the
          // URL clean and lets unknown-MW/year facilities pass through again.
          if (next[0] === bounds[0] && next[1] === bounds[1]) {
            onChange(null);
          } else {
            onChange(next);
          }
        }}
        data-testid={testId}
      />
      <div className="flex justify-between text-[10px] text-neutral-600 font-mono">
        <span>{format(bounds[0])}</span>
        <span>{format(bounds[1])}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayEqualsAsSet<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
