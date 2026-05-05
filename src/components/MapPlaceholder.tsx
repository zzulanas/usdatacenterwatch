import { cn } from '@/lib/cn';

interface MapPlaceholderProps {
  className?: string;
}

function MapPlaceholder({ className }: MapPlaceholderProps) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center w-full bg-neutral-900 border border-neutral-800 rounded-md overflow-hidden',
        'aspect-[16/10]',
        className
      )}
      aria-label="Map placeholder — MapLibre integration coming in USD-10"
    >
      {/* Grid overlay to suggest a map */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'linear-gradient(to right, #6b7280 1px, transparent 1px), linear-gradient(to bottom, #6b7280 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="relative z-10 flex flex-col items-center gap-3 text-neutral-500 select-none">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
          <line x1="9" x2="9" y1="3" y2="18" />
          <line x1="15" x2="15" y1="6" y2="21" />
        </svg>
        <p className="text-sm font-mono tracking-wide uppercase">Map will go here</p>
        <p className="text-xs text-neutral-600">MapLibre GL JS — USD-10</p>
      </div>
    </div>
  );
}

export default MapPlaceholder;
