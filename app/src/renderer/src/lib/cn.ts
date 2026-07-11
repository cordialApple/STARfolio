import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'canvas',
        'surface',
        'raised',
        'ink',
        'muted',
        'faint',
        'line',
        'line-strong',
        'focus',
        'overlay',
        'brand',
        'brand-strong',
        'brand-soft',
        'on-brand',
        'pop',
        'pop-strong',
        'on-pop',
        'star-s',
        'star-t',
        'star-a',
        'star-r',
        'success',
        'warning',
        'danger',
        'danger-strong',
        'info',
        'fg-brand',
        'fg-violet',
        'fg-success',
        'fg-warning',
        'fg-danger',
        'fg-info'
      ],
      radius: ['pill'],
      shadow: ['card', 'pop'],
      ease: ['spring', 'soft'],
      font: ['sans', 'mono']
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
