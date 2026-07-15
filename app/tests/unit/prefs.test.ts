import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPrefs, setPrefs } from '../../src/main/settings/prefs'
import { initDb } from '../../src/main/db/client'

beforeEach(() => {
  initDb(':memory:')
})
afterEach(() => vi.unstubAllEnvs())

describe('getPrefs', () => {
  it('returns defaults on an empty store', () => {
    expect(getPrefs()).toEqual({
      reminderEnabled: false,
      reminderIntervalDays: 14,
      launchAtLogin: false,
      trayResident: false,
      onboardingDone: false,
      reminderSnoozedAt: null,
      voiceModel: 'base.en'
    })
  })

  it('forces onboardingDone under E2E when nothing is stored', () => {
    vi.stubEnv('STARFOLIO_E2E', '1')
    expect(getPrefs().onboardingDone).toBe(true)
  })

  it('respects a stored onboarding flag even under E2E', () => {
    vi.stubEnv('STARFOLIO_E2E', '1')
    setPrefs({ onboardingDone: false })
    expect(getPrefs().onboardingDone).toBe(false)
  })
})

describe('setPrefs', () => {
  it('round-trips booleans through 1/0 encoding', () => {
    const out = setPrefs({ reminderEnabled: true, launchAtLogin: true, trayResident: false })
    expect(out.reminderEnabled).toBe(true)
    expect(out.launchAtLogin).toBe(true)
    expect(out.trayResident).toBe(false)
  })

  it('round-trips the reminder interval and voice model', () => {
    const out = setPrefs({ reminderIntervalDays: 30, voiceModel: 'small.en' })
    expect(out.reminderIntervalDays).toBe(30)
    expect(out.voiceModel).toBe('small.en')
  })

  it('stores a snooze timestamp and clears it back to null', () => {
    expect(setPrefs({ reminderSnoozedAt: '2026-01-01T00:00:00Z' }).reminderSnoozedAt).toBe(
      '2026-01-01T00:00:00Z'
    )
    expect(setPrefs({ reminderSnoozedAt: null }).reminderSnoozedAt).toBeNull()
  })

  it('merges partial patches over prior values', () => {
    setPrefs({ reminderEnabled: true, reminderIntervalDays: 7 })
    const out = setPrefs({ reminderIntervalDays: 21 })
    expect(out.reminderEnabled).toBe(true)
    expect(out.reminderIntervalDays).toBe(21)
  })
})
