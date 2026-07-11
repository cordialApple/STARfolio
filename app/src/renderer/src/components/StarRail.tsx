import { cn } from '../lib/cn'

export type StarBeat = 's' | 't' | 'a' | 'r'
export const STAR_BEATS: StarBeat[] = ['s', 't', 'a', 'r']
export const STAR_LABELS: Record<StarBeat, string> = {
  s: 'Situation',
  t: 'Task',
  a: 'Action',
  r: 'Result'
}

const beatFill: Record<StarBeat, string> = {
  s: 'bg-star-s',
  t: 'bg-star-t',
  a: 'bg-star-a',
  r: 'bg-star-r'
}

export type StarRailVariant = 'inline' | 'gutter' | 'mark'

export interface StarRailProps {
  filled: StarBeat[]
  variant?: StarRailVariant
  className?: string
  label?: string
}

export function StarRail({
  filled,
  variant = 'inline',
  className,
  label
}: StarRailProps): React.JSX.Element {
  const ariaLabel = label ?? `STAR progress: ${filled.length} of 4 beats complete`

  if (variant === 'mark') {
    return (
      <span
        role="img"
        aria-label={label ?? 'STARfolio'}
        className={cn('inline-grid grid-cols-2 gap-0.5', className)}
      >
        {STAR_BEATS.map((b) => (
          <span key={b} className={cn('size-2.5 rounded-[3px]', beatFill[b])} />
        ))}
      </span>
    )
  }

  const isGutter = variant === 'gutter'
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn(
        'flex gap-1',
        isGutter ? 'h-full w-1.5 flex-col' : 'h-2 w-full',
        className
      )}
    >
      {STAR_BEATS.map((b) => (
        <span
          key={b}
          className={cn(
            'flex-1 rounded-pill transition-colors duration-300 ease-soft',
            filled.includes(b) ? beatFill[b] : 'bg-line'
          )}
        />
      ))}
    </span>
  )
}
