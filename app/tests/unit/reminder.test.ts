import { describe, it, expect } from 'vitest'
import { shouldRemind } from '../../src/main/nudges/reminder'
import type { Prefs, Staleness } from '../../src/main/settings/prefs'

const NOW = Date.parse('2026-07-12T00:00:00.000Z')

function prefs(over: Partial<Prefs> = {}): Prefs {
  return {
    reminderEnabled: true,
    reminderIntervalDays: 14,
    launchAtLogin: false,
    trayResident: false,
    onboardingDone: false,
    reminderSnoozedAt: null,
    ...over
  }
}

function stale(daysSinceLast: number | null, count = 3): Staleness {
  return { count, daysSinceLast }
}

describe('shouldRemind', () => {
  it('reminds when idle past the interval', () => {
    expect(shouldRemind(prefs(), stale(20), NOW)).toBe(true)
  })

  it('stays quiet when reminders are off', () => {
    expect(shouldRemind(prefs({ reminderEnabled: false }), stale(20), NOW)).toBe(false)
  })

  it('stays quiet with an empty bank', () => {
    expect(shouldRemind(prefs(), stale(20, 0), NOW)).toBe(false)
  })

  it('stays quiet when never logged (null days)', () => {
    expect(shouldRemind(prefs(), stale(null), NOW)).toBe(false)
  })

  it('stays quiet below the interval', () => {
    expect(shouldRemind(prefs(), stale(13), NOW)).toBe(false)
  })

  it('stays quiet within the snooze window', () => {
    const snoozedAt = new Date(NOW - 3 * 86_400_000).toISOString()
    expect(shouldRemind(prefs({ reminderSnoozedAt: snoozedAt }), stale(20), NOW)).toBe(false)
  })

  it('reminds again after the snooze window lapses', () => {
    const snoozedAt = new Date(NOW - 20 * 86_400_000).toISOString()
    expect(shouldRemind(prefs({ reminderSnoozedAt: snoozedAt }), stale(30), NOW)).toBe(true)
  })
})
