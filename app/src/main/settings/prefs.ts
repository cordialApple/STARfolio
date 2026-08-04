import { z } from 'zod'
import { getDb } from '../db/client'
import { PROVIDERS, type Provider } from '../ai/routing'

const VOICE_MODELS = ['tiny.en', 'base.en', 'small.en'] as const
type VoiceModel = (typeof VOICE_MODELS)[number]

const STORAGE_MODES = ['sqlite', 'obsidian'] as const
type StorageMode = (typeof STORAGE_MODES)[number]

const httpUrl = z
  .string()
  .transform((s) => s.replace(/\/+$/, ''))
  .refine((s) => {
    try {
      const u = new URL(s)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }, 'must be an http or https URL')

export const prefsPatch = z
  .object({
    reminderEnabled: z.boolean(),
    reminderIntervalDays: z.number().int().min(1).max(365),
    launchAtLogin: z.boolean(),
    trayResident: z.boolean(),
    onboardingDone: z.boolean(),
    reminderSnoozedAt: z.string().nullable(),
    voiceModel: z.enum(VOICE_MODELS),
    storageMode: z.enum(STORAGE_MODES),
    vaultPath: z.string().nullable(),
    loopbackEnabled: z.boolean(),
    providerArchitect: z.enum(PROVIDERS),
    providerEvaluator: z.enum(PROVIDERS),
    providerConversation: z.enum(PROVIDERS),
    openaiBaseUrl: httpUrl,
    openaiModelArchitect: z.string(),
    openaiModelEvaluator: z.string(),
    openaiModelConversation: z.string(),
    geminiModelArchitect: z.string(),
    geminiModelEvaluator: z.string(),
    geminiModelConversation: z.string()
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
  voiceModel: VoiceModel
  storageMode: StorageMode
  vaultPath: string | null
  loopbackEnabled: boolean
  providerArchitect: Provider
  providerEvaluator: Provider
  providerConversation: Provider
  openaiBaseUrl: string
  openaiModelArchitect: string
  openaiModelEvaluator: string
  openaiModelConversation: string
  geminiModelArchitect: string
  geminiModelEvaluator: string
  geminiModelConversation: string
}

const DEFAULTS: Prefs = {
  reminderEnabled: false,
  reminderIntervalDays: 14,
  launchAtLogin: false,
  trayResident: false,
  onboardingDone: false,
  reminderSnoozedAt: null,
  voiceModel: 'base.en',
  storageMode: 'sqlite',
  vaultPath: null,
  loopbackEnabled: false,
  providerArchitect: 'anthropic',
  providerEvaluator: 'anthropic',
  providerConversation: 'anthropic',
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiModelArchitect: '',
  openaiModelEvaluator: '',
  openaiModelConversation: '',
  geminiModelArchitect: '',
  geminiModelEvaluator: '',
  geminiModelConversation: ''
}

interface Codec<T> {
  key: string
  decode: (raw: string) => T | undefined
  encode: (v: T) => string
}

const createBoolCodec = (key: string): Codec<boolean> => ({
  key,
  decode: (raw) => raw === '1',
  encode: (v) => (v ? '1' : '0')
})

const createNullableStringCodec = (key: string): Codec<string | null> => ({
  key,
  decode: (raw) => raw || null,
  encode: (v) => v ?? ''
})

const createStringCodec = (key: string): Codec<string> => ({
  key,
  decode: (raw) => raw,
  encode: (v) => v
})

const createEnumCodec = <T extends string>(key: string, values: readonly T[]): Codec<T> => ({
  key,
  decode: (raw) => (values.includes(raw as T) ? (raw as T) : undefined),
  encode: (v) => v
})

const createPositiveIntCodec = (key: string): Codec<number> => ({
  key,
  decode: (raw) => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : undefined
  },
  encode: (v) => String(v)
})

const CODECS: { [K in keyof Prefs]: Codec<Prefs[K]> } = {
  reminderEnabled: createBoolCodec('pref.reminder.enabled'),
  reminderIntervalDays: createPositiveIntCodec('pref.reminder.interval_days'),
  launchAtLogin: createBoolCodec('pref.startup.launch_at_login'),
  trayResident: createBoolCodec('pref.tray.resident'),
  onboardingDone: createBoolCodec('pref.onboarding.done'),
  reminderSnoozedAt: createNullableStringCodec('pref.reminder.snoozed_at'),
  voiceModel: createEnumCodec('pref.voice.model', VOICE_MODELS),
  storageMode: createEnumCodec('pref.storage.mode', STORAGE_MODES),
  vaultPath: createNullableStringCodec('pref.storage.vault_path'),
  loopbackEnabled: createBoolCodec('pref.loopback.enabled'),
  providerArchitect: createEnumCodec('pref.ai.provider.architect', PROVIDERS),
  providerEvaluator: createEnumCodec('pref.ai.provider.evaluator', PROVIDERS),
  providerConversation: createEnumCodec('pref.ai.provider.conversation', PROVIDERS),
  openaiBaseUrl: createStringCodec('pref.ai.openai.base_url'),
  openaiModelArchitect: createStringCodec('pref.ai.openai.model.architect'),
  openaiModelEvaluator: createStringCodec('pref.ai.openai.model.evaluator'),
  openaiModelConversation: createStringCodec('pref.ai.openai.model.conversation'),
  geminiModelArchitect: createStringCodec('pref.ai.gemini.model.architect'),
  geminiModelEvaluator: createStringCodec('pref.ai.gemini.model.evaluator'),
  geminiModelConversation: createStringCodec('pref.ai.gemini.model.conversation')
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
  let onboardingStored = false
  for (const k of Object.keys(CODECS) as (keyof Prefs)[]) {
    const raw = readRaw(CODECS[k].key)
    if (raw == null) continue
    if (k === 'onboardingDone') onboardingStored = true
    const decoded = CODECS[k].decode(raw)
    if (decoded !== undefined) out[k] = decoded as never
  }
  if (process.env.STARFOLIO_E2E === '1' && !onboardingStored) {
    out.onboardingDone = true
  }
  return out
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const tx = getDb().transaction(() => {
    for (const k of Object.keys(patch) as (keyof Prefs)[]) {
      const v = patch[k]
      if (v === undefined) continue
      writeRaw(CODECS[k].key, CODECS[k].encode(v as never))
    }
  })
  tx()
  return getPrefs()
}

export interface Staleness {
  count: number
  daysSinceLast: number | null
}

export function computeStaleness(): Staleness {
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
