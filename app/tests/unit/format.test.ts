import { describe, expect, it } from 'vitest'
import { filledBeats, formatDateRange } from '../../src/renderer/src/lib/format'

describe('filledBeats', () => {
  it('emits s/t/a/r in order for whichever beats are filled', () => {
    expect(filledBeats({ situation: true, task: true, action: true, result: true })).toEqual([
      's',
      't',
      'a',
      'r'
    ])
    expect(filledBeats({ situation: true, task: false, action: false, result: true })).toEqual([
      's',
      'r'
    ])
    expect(filledBeats({ situation: false, task: false, action: false, result: false })).toEqual([])
  })
})

describe('formatDateRange', () => {
  it('returns empty when neither bound is set', () => {
    expect(formatDateRange(null, null)).toBe('')
  })

  it('formats a start-only range as the single month', () => {
    expect(formatDateRange('2024-03', null)).toBe('Mar 2024')
  })

  it('prefixes an end-only range with until', () => {
    expect(formatDateRange(null, '2024-05')).toBe('until May 2024')
  })

  it('collapses a same-month range to one label', () => {
    expect(formatDateRange('2024-03', '2024-03')).toBe('Mar 2024')
  })

  it('joins a spanning range with an en dash', () => {
    expect(formatDateRange('2024-03', '2025-01')).toBe('Mar 2024 – Jan 2025')
  })

  it('degrades an out-of-range month to the year alone', () => {
    expect(formatDateRange('2024-13', null)).toBe('2024')
    expect(formatDateRange('2024-00', null)).toBe('2024')
  })
})
