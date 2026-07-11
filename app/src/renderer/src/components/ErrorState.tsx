import { type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '../lib/cn'

export interface ErrorStateProps {
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  className
}: ErrorStateProps): React.JSX.Element {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-danger/40 bg-danger/5 px-6 py-10 text-center',
        className
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-pill bg-danger/15 text-fg-danger">
        <AlertTriangle aria-hidden className="size-6" />
      </span>
      <div className="space-y-1">
        <h3 className="text-base font-bold text-ink">{title}</h3>
        {description && <p className="mx-auto max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}
