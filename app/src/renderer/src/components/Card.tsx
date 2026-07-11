import { type ComponentPropsWithRef, type ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface CardProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  title?: ReactNode
  action?: ReactNode
}

export function Card({
  title,
  action,
  className,
  children,
  ...props
}: CardProps): React.JSX.Element {
  return (
    <section
      className={cn('rounded-xl border border-line bg-surface shadow-card', className)}
      {...props}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}
