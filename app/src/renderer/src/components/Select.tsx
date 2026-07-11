import { type ComponentPropsWithRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'

const base =
  'h-10 w-full appearance-none rounded-lg border border-line bg-surface pl-3 pr-9 text-sm text-ink transition-colors duration-150 ease-soft disabled:cursor-not-allowed disabled:opacity-50'

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  invalid?: boolean
}

export function Select({ invalid, className, children, ...props }: SelectProps): React.JSX.Element {
  return (
    <div className="relative inline-flex w-full items-center">
      <select
        aria-invalid={invalid || undefined}
        className={cn(base, invalid && 'border-danger', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-faint" />
    </div>
  )
}
