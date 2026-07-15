import { describe, expect, it } from 'vitest'
import { normalizeMode, nextMode, resolveMode } from '../../src/renderer/src/theme/theme-logic'

describe('normalizeMode', () => {
  it('keeps a valid stored mode', () => {
    expect(normalizeMode('light')).toBe('light')
    expect(normalizeMode('dark')).toBe('dark')
    expect(normalizeMode('system')).toBe('system')
  })

  it('falls back to system for garbage or absent storage', () => {
    expect(normalizeMode(null)).toBe('system')
    expect(normalizeMode('')).toBe('system')
    expect(normalizeMode('DARK')).toBe('system')
    expect(normalizeMode('midnight')).toBe('system')
  })
})

describe('nextMode', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextMode('system')).toBe('light')
    expect(nextMode('light')).toBe('dark')
    expect(nextMode('dark')).toBe('system')
  })
})

describe('resolveMode', () => {
  it('resolves system mode against the OS dark preference', () => {
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
  })

  it('honors an explicit mode regardless of OS preference', () => {
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
  })
})
