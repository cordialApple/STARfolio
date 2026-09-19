import { describe, expect, it } from 'vitest'
import { shouldCaptureDemoAudio } from './capture-mode'

describe('demo microphone permission boundary', () => {
  it('never opens a microphone for the local fixture', () => {
    expect(shouldCaptureDemoAudio('fixture', true)).toBe(false)
    expect(shouldCaptureDemoAudio('moshi', true)).toBe(true)
  })
  it('requires exact consent and an explicit model mode', () => {
    for (const consent of [false, undefined, null, 'true'])
      expect(() => shouldCaptureDemoAudio('moshi', consent)).toThrow('Consent required')
    for (const mode of [undefined, null, '', 'unknown'])
      expect(() => shouldCaptureDemoAudio(mode, true)).toThrow('Unknown gateway mode')
  })
})
