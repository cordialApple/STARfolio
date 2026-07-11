import { Sparkles } from 'lucide-react'
import { cn } from '../lib/cn'

export interface CadenceNudgeProps {
  count: number
  period?: string
  className?: string
}

export function CadenceNudge({
  count,
  period = 'this week',
  className
}: CadenceNudgeProps): React.JSX.Element {
  const noun = count === 1 ? 'entry' : 'entries'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill bg-pop/15 px-3 py-1 text-xs font-semibold text-ink',
        className
      )}
    >
      <Sparkles aria-hidden className="size-3.5 text-fg-success" />
      Logged {count} {noun} {period}
    </span>
  )
}
