import { expect, it } from 'vitest'
import { pcm16ToFloat32 } from './scripted-audio'

it('decodes mono PCM16 into the interview float sample format', () => {
  expect([...pcm16ToFloat32(Buffer.from([0, 0, 0, 128, 255, 127]))]).toEqual([
    0,
    -1,
    32767 / 32768
  ])
})

it('rejects incomplete PCM samples', () => {
  expect(() => pcm16ToFloat32(Buffer.from([0]))).toThrow('Invalid scripted PCM')
})
