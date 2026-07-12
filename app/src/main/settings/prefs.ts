import { z } from 'zod'
import { getDb } from '../db/client'

export const prefsPatch = z
  .object({
    reminderEnabled: z.boolean(),
    reminderIntervalDays: z.number().int().min(1).max(365),
    launchAtLogin: z.boolean(),
    trayResident: z.boolean(),
    onboardingDone: z.boolean(),
    reminderSnoozedAt: z.string().nullable()
  })
  .partial()
  .strict()

export interface Prefs {
  reminderEnabled: boolean
  reminderIntervalDays: number
  launchAtLogin: boolean
  trayResident: boolean
  onboardingDone: boolean
  reminderSnoozedAt: string | null
}

const DEFAULTS: Prefs = {
  reminderEnabled: false,
  reminderIntervalDays: 14,
  launchAtLogin: false,
  trayResident: false,
  onboardingDone: false,
  reminderSnoozedAt: null
}

const KEYS: Record<keyof Prefs, string> = {
  reminderEnabled: 'pref.reminder.enabled',
  reminderIntervalDays: 'pref.reminder.interval_days',
  launchAtLogin: 'pref.startup.launch_at_login',
  trayResident: 'pref.tray.resident',
  onboardingDone: 'pref.onboarding.done',
  reminderSnoozedAt: 'pref.reminder.snoozed_at'
}

function readRaw(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeRaw(key: string, value: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, value)
}

export function getPrefs(): Prefs {
  const out = { ...DEFAULTS }
  for (const k of Object.keys(KEYS) as (keyof Prefs)[]) {
    const raw = readRaw(KEYS[k])
    if (raw == null) continue
    if (k === 'reminderIntervalDays') {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) out.reminderIntervalDays = n
    } else if (k === 'reminderSnoozedAt') {
      out.reminderSnoozedAt = raw || null
    } else {
      out[k] = (raw === '1') as never
    }
  }
  return out
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const tx = getDb().transaction(() => {
    for (const k of Object.keys(patch) as (keyof Prefs)[]) {
      const v = patch[k]
      if (v === undefined) continue
      const raw =
        typeof v === 'boolean' ? (v ? '1' : '0') : v === null ? '' : String(v)
      writeRaw(KEYS[k], raw)
    }
  })
  tx()
  return getPrefs()
}

export interface Staleness {
  count: number
  daysSinceLast: number | null
}

export function staleness(): Staleness {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count,
              julianday('now') - julianday(MAX(updated_at)) AS days
         FROM experiences`
    )
    .get() as { count: number; days: number | null }
  return {
    count: row.count,
    daysSinceLast: row.days == null ? null : Math.floor(row.days)
  }
}
