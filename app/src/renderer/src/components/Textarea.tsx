import { type ComponentPropsWithRef } from 'react'
import { cn } from '../lib/cn'

const base =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink transition-colors duration-150 ease-soft placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-50'

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  invalid?: boolean
}

export function Textarea({ invalid, className, ...props }: TextareaProps): React.JSX.Element {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(base, invalid ? 'border-danger' : 'border-line', className)}
      {...props}
    />
  )
}
