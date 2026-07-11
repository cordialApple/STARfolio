import { type ComponentPropsWithRef } from 'react'
import { cn } from '../lib/cn'

export type IconButtonVariant = 'ghost' | 'surface'
export type IconButtonSize = 'sm' | 'md'

const base =
  'inline-flex select-none items-center justify-center rounded-lg text-ink transition-[background-color,transform] duration-150 ease-soft active:scale-[0.94] disabled:pointer-events-none disabled:opacity-50'

const variants: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent hover:bg-raised',
  surface: 'border border-line bg-surface hover:bg-raised'
}

const sizes: Record<IconButtonSize, string> = {
  sm: 'size-8',
  md: 'size-10'
}

export interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  label: string
  variant?: IconButtonVariant
  size?: IconButtonSize
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  )
}
