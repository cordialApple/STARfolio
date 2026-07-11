import { type ComponentPropsWithRef } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../lib/cn'

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  label?: string
}

export function Checkbox({
  label,
  className,
  id,
  ...props
}: CheckboxProps): React.JSX.Element {
  const box = (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
      <input
        id={id}
        type="checkbox"
        className={cn(
          'peer size-5 cursor-pointer appearance-none rounded-md border border-line bg-surface transition-colors duration-150 ease-soft checked:border-brand checked:bg-brand disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
      <Check className="pointer-events-none absolute size-3.5 text-on-brand opacity-0 peer-checked:opacity-100" />
    </span>
  )
  if (!label) return box
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
      {box}
      {label}
    </label>
  )
}
