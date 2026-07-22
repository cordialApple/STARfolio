import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPrefs, prefsPatch } from '../../src/main/settings/prefs'
import { getDb, initDb } from '../../src/main/db/client'

beforeEach(() => {
  initDb(':memory:')
})
afterEach(() => vi.unstubAllEnvs())

function writeRaw(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

describe('prefsPatch', () => {
  it('accepts an empty patch and any subset of known keys', () => {
    expect(prefsPatch.parse({})).toEqual({})
    expect(prefsPatch.parse({ reminderEnabled: true })).toEqual({ reminderEnabled: true })
  })

  it('rejects unknown keys under strict mode', () => {
    expect(() => prefsPatch.parse({ bogus: 1 })).toThrow()
  })

  it('rejects an out-of-range reminder interval', () => {
    expect(() => prefsPatch.parse({ reminderIntervalDays: 0 })).toThrow()
    expect(() => prefsPatch.parse({ reminderIntervalDays: 366 })).toThrow()
    expect(() => prefsPatch.parse({ reminderIntervalDays: 2.5 })).toThrow()
  })

  it('rejects an unknown voice model', () => {
    expect(() => prefsPatch.parse({ voiceModel: 'huge.en' })).toThrow()
    expect(prefsPatch.parse({ voiceModel: 'tiny.en' })).toEqual({ voiceModel: 'tiny.en' })
  })

  it('accepts a known provider and rejects an unknown one', () => {
    expect(prefsPatch.parse({ providerConversation: 'openai' })).toEqual({
      providerConversation: 'openai'
    })
    expect(() => prefsPatch.parse({ providerArchitect: 'llama' })).toThrow()
  })

  it('accepts http(s) base URLs and strips a trailing slash', () => {
    expect(prefsPatch.parse({ openaiBaseUrl: 'http://localhost:11434/v1/' })).toEqual({
      openaiBaseUrl: 'http://localhost:11434/v1'
    })
    expect(prefsPatch.parse({ openaiBaseUrl: 'https://api.openai.com/v1' })).toEqual({
      openaiBaseUrl: 'https://api.openai.com/v1'
    })
  })

  it('rejects a non-http base URL', () => {
    expect(() => prefsPatch.parse({ openaiBaseUrl: 'ftp://host/v1' })).toThrow()
    expect(() => prefsPatch.parse({ openaiBaseUrl: 'not a url' })).toThrow()
    expect(() => prefsPatch.parse({ openaiBaseUrl: 'file:///etc/passwd' })).toThrow()
  })
})

describe('getPrefs coercion of malformed stored values', () => {
  it('falls back to the default interval when the stored value is not a positive number', () => {
    writeRaw('pref.reminder.interval_days', 'not-a-number')
    expect(getPrefs().reminderIntervalDays).toBe(14)
    writeRaw('pref.reminder.interval_days', '-3')
    expect(getPrefs().reminderIntervalDays).toBe(14)
  })

  it('ignores an unrecognized stored voice model', () => {
    writeRaw('pref.voice.model', 'huge.en')
    expect(getPrefs().voiceModel).toBe('base.en')
  })

  it('reads an empty snooze string back as null', () => {
    writeRaw('pref.reminder.snoozed_at', '')
    expect(getPrefs().reminderSnoozedAt).toBeNull()
  })

  it('ignores an unrecognized stored provider', () => {
    writeRaw('pref.ai.provider.conversation', 'llama')
    expect(getPrefs().providerConversation).toBe('anthropic')
  })

  it('reads a stored provider and model back', () => {
    writeRaw('pref.ai.provider.evaluator', 'openai')
    writeRaw('pref.ai.openai.model.evaluator', 'qwen2.5')
    const out = getPrefs()
    expect(out.providerEvaluator).toBe('openai')
    expect(out.openaiModelEvaluator).toBe('qwen2.5')
  })

  it('treats any non-"1" boolean raw as false', () => {
    writeRaw('pref.reminder.enabled', '0')
    writeRaw('pref.tray.resident', 'true')
    const out = getPrefs()
    expect(out.reminderEnabled).toBe(false)
    expect(out.trayResident).toBe(false)
  })
})
