import { type ComponentPropsWithRef } from 'react'
import { cn } from '../lib/cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold transition-[background-color,box-shadow,transform,filter] duration-150 ease-soft active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-strong text-on-brand shadow-card hover:brightness-95',
  secondary: 'border border-line bg-surface text-ink hover:bg-raised',
  ghost: 'bg-transparent text-ink hover:bg-raised',
  danger: 'bg-danger-strong text-on-brand hover:brightness-95'
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base'
}

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}
