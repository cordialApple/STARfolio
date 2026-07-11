import { type ComponentPropsWithRef } from 'react'
import { cn } from '../lib/cn'

export interface ToggleProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  className,
  ...props
}: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-pill border border-transparent px-0.5 transition-colors duration-150 ease-soft disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-line-strong',
        className
      )}
      {...props}
    >
      <span
        className={cn(
          'size-5 rounded-pill bg-white shadow-card transition-transform duration-150 ease-spring',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}
