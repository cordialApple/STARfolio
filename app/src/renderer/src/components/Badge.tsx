import { type ComponentPropsWithRef } from 'react'
import { cn } from '../lib/cn'

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 's'
  | 't'
  | 'a'
  | 'r'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-muted',
  brand: 'bg-brand/12 text-fg-brand',
  success: 'bg-success/15 text-fg-success',
  warning: 'bg-warning/20 text-fg-warning',
  danger: 'bg-danger/15 text-fg-danger',
  info: 'bg-info/15 text-fg-info',
  s: 'bg-star-s/15 text-fg-info',
  t: 'bg-star-t/15 text-fg-violet',
  a: 'bg-star-a/20 text-fg-warning',
  r: 'bg-star-r/15 text-fg-success'
}

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  tone?: BadgeTone
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
