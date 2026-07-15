import { describe, expect, it } from 'vitest'
import { cn } from '../../src/renderer/src/lib/cn'

describe('cn', () => {
  it('passes clsx conditionals through, dropping falsy values', () => {
    const off = false
    expect(cn('a', off && 'b', null, undefined, 'c', ['d', 'e'])).toBe('a c d e')
  })

  it('resolves conflicts on the custom brand color scale (last wins)', () => {
    expect(cn('bg-brand', 'bg-canvas')).toBe('bg-canvas')
    expect(cn('text-ink', 'text-muted')).toBe('text-muted')
  })

  it('resolves conflicts on the custom pill radius token', () => {
    expect(cn('rounded-pill', 'rounded-lg')).toBe('rounded-lg')
  })

  it('keeps classes from different property groups', () => {
    expect(cn('bg-brand', 'text-ink', 'px-2')).toBe('bg-brand text-ink px-2')
  })
})
