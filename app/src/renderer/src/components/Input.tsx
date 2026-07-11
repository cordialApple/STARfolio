import { type ComponentPropsWithRef } from 'react'
import { cn } from '../lib/cn'

const base =
  'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink transition-colors duration-150 ease-soft placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-50'

export interface InputProps extends ComponentPropsWithRef<'input'> {
  invalid?: boolean
}

export function Input({ invalid, className, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(base, invalid ? 'border-danger' : 'border-line', className)}
      {...props}
    />
  )
}
