import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  whisperModels,
  deleteWhisperModel,
  ensureWhisperModel,
  WHISPER_MODELS
} from '../../src/main/voice/model'

describe('whisperModels (stub)', () => {
  beforeEach(() => {
    process.env.STARFOLIO_WHISPER_STUB = '1'
  })
  afterEach(() => {
    delete process.env.STARFOLIO_WHISPER_STUB
  })

  it('reports the full model set in order with its sizes', () => {
    const models = whisperModels()
    expect(models.map((m) => m.name)).toEqual([...WHISPER_MODELS])
    expect(models.map((m) => m.sizeMB)).toEqual([75, 142, 466])
  })

  it('promotes a downloaded model with idle status to ready', () => {
    const base = whisperModels().find((m) => m.name === 'base.en')!
    expect(base.downloaded).toBe(true)
    expect(base.status).toEqual({ phase: 'ready', progress: 100, error: null })
  })

  it('leaves non-downloaded models idle', () => {
    for (const name of ['tiny.en', 'small.en']) {
      const m = whisperModels().find((x) => x.name === name)!
      expect(m.downloaded).toBe(false)
      expect(m.status.phase).toBe('idle')
    }
  })
})

describe('accept-list guard', () => {
  it('rejects unknown model names', async () => {
    expect(() => deleteWhisperModel('bogus.en')).toThrow('unknown whisper model: bogus.en')
    await expect(ensureWhisperModel('bogus.en')).rejects.toThrow('unknown whisper model: bogus.en')
  })
})
