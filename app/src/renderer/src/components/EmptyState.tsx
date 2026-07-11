import { type ComponentType, type ReactNode } from 'react'
import { type LucideProps } from 'lucide-react'
import { cn } from '../lib/cn'

export interface EmptyStateProps {
  icon?: ComponentType<LucideProps>
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center',
        className
      )}
    >
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-pill bg-brand-soft text-fg-brand">
          <Icon aria-hidden className="size-6" />
        </span>
      )}
      <div className="space-y-1">
        <h3 className="text-base font-bold text-ink">{title}</h3>
        {description && <p className="mx-auto max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}
