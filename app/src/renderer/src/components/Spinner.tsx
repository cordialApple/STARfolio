import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'

export function Spinner({
  className,
  label = 'Loading'
}: {
  className?: string
  label?: string
}): React.JSX.Element {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('size-4 animate-spin text-current', className)}
    />
  )
}
