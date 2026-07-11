import { type ComponentPropsWithRef } from 'react'
import { cn } from '../lib/cn'

export function Skeleton({ className, ...props }: ComponentPropsWithRef<'div'>): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-raised motion-reduce:animate-none', className)}
      {...props}
    />
  )
}
