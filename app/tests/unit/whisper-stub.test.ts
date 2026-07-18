import { afterEach, describe, expect, it } from 'vitest'
import { isWhisperStub } from '../../src/main/voice/whisper-stub'

const original = process.env.STARFOLIO_WHISPER_STUB

afterEach(() => {
  if (original === undefined) delete process.env.STARFOLIO_WHISPER_STUB
  else process.env.STARFOLIO_WHISPER_STUB = original
})

describe('isWhisperStub', () => {
  it('is true only for the exact opt-in value "1"', () => {
    process.env.STARFOLIO_WHISPER_STUB = '1'
    expect(isWhisperStub()).toBe(true)
  })

  it('is false when unset', () => {
    delete process.env.STARFOLIO_WHISPER_STUB
    expect(isWhisperStub()).toBe(false)
  })

  it('is false for any other value', () => {
    for (const v of ['0', 'true', 'yes', '', ' 1 ']) {
      process.env.STARFOLIO_WHISPER_STUB = v
      expect(isWhisperStub()).toBe(false)
    }
  })
})
