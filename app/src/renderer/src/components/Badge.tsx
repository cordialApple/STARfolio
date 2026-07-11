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
  brand: 'bg-brand/12 text-brand',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/20 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
  s: 'bg-star-s/15 text-star-s',
  t: 'bg-star-t/15 text-star-t',
  a: 'bg-star-a/20 text-star-a',
  r: 'bg-star-r/15 text-star-r'
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
