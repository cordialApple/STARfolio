import { beforeEach, describe, expect, it } from 'vitest'
import { getPrefs, setPrefs } from '../../src/main/settings/prefs'
import { getDb, initDb } from '../../src/main/db/client'

beforeEach(() => initDb(':memory:'))

function settingsCount(): number {
  return (getDb().prepare('SELECT COUNT(*) c FROM settings').get() as { c: number }).c
}

describe('setPrefs undefined keys', () => {
  it('skips keys whose value is undefined and writes only defined ones', () => {
    const out = setPrefs({ launchAtLogin: undefined, reminderEnabled: true })
    expect(out.reminderEnabled).toBe(true)
    expect(out.launchAtLogin).toBe(false)
    expect(settingsCount()).toBe(1)
  })

  it('writes nothing when every key is undefined', () => {
    setPrefs({ trayResident: undefined })
    expect(settingsCount()).toBe(0)
    expect(getPrefs().trayResident).toBe(false)
  })
})
