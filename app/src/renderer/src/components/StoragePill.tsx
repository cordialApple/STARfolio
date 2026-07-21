import { cn } from '../lib/cn'

export type StorageMode = 'sqlite' | 'obsidian'

export interface StoragePillProps {
  value: StorageMode
  onChange: (mode: StorageMode) => void
  disabled?: boolean
  className?: string
}

const OPTIONS: { mode: StorageMode; label: string }[] = [
  { mode: 'sqlite', label: 'SQLite' },
  { mode: 'obsidian', label: 'Obsidian' }
]

export function StoragePill({
  value,
  onChange,
  disabled,
  className
}: StoragePillProps): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Storage backend"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-pill border border-line-strong bg-raised p-0.5',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      {OPTIONS.map(({ mode, label }) => {
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(mode)}
            className={cn(
              'rounded-pill px-3.5 py-1 text-sm font-semibold transition-all duration-150 ease-soft',
              active ? 'metallic-purple text-[#2a1a63]' : 'text-muted hover:text-ink'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
