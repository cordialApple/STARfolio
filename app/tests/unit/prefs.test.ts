import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPrefs, setPrefs, staleness } from '../../src/main/settings/prefs'
import { getDb, initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'

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
      voiceModel: 'base.en',
      storageMode: 'sqlite',
      vaultPath: null,
      loopbackEnabled: false
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

  it('round-trips the loopback gate flag', () => {
    expect(setPrefs({ loopbackEnabled: true }).loopbackEnabled).toBe(true)
    expect(setPrefs({ loopbackEnabled: false }).loopbackEnabled).toBe(false)
  })

  it('merges partial patches over prior values', () => {
    setPrefs({ reminderEnabled: true, reminderIntervalDays: 7 })
    const out = setPrefs({ reminderIntervalDays: 21 })
    expect(out.reminderEnabled).toBe(true)
    expect(out.reminderIntervalDays).toBe(21)
  })
})

describe('staleness', () => {
  it('reports zero and null on an empty store', () => {
    expect(staleness()).toEqual({ count: 0, daysSinceLast: null })
  })

  it('counts experiences and reads zero days right after insert', () => {
    createExperience({ title: 'a' })
    createExperience({ title: 'b' })
    expect(staleness()).toEqual({ count: 2, daysSinceLast: 0 })
  })

  it('floors a fractional day delta from a backdated update', () => {
    createExperience({ title: 'old' })
    getDb().prepare(`UPDATE experiences SET updated_at = datetime('now', '-5.5 days')`).run()
    expect(staleness()).toEqual({ count: 1, daysSinceLast: 5 })
  })
})
