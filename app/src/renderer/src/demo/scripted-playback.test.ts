import { expect, it, vi } from 'vitest'
import { playScriptedAudio } from './scripted-playback'

function fakeAudio() {
  const copied = vi.fn()
  const source = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  }
  const context = {
    destination: {},
    createBuffer: vi.fn(() => ({ copyToChannel: copied, duration: 2 })),
    createBufferSource: vi.fn(() => source)
  } as unknown as AudioContext
  return { context, source, copied }
}

it('plays supplied PCM at scheduled time and resolves after output ends', async () => {
  const { context, source, copied } = fakeAudio()
  const samples = new Float32Array([0.2, -0.4])
  const played = playScriptedAudio(context, samples, 3, new AbortController().signal)
  expect(copied).toHaveBeenCalledWith(samples, 0)
  expect(source.start).toHaveBeenCalledWith(3)
  source.onended?.()
  await expect(played).resolves.toBeUndefined()
})

it('stops output and rejects when interview ends mid-line', async () => {
  const { context, source } = fakeAudio()
  const controller = new AbortController()
  const played = playScriptedAudio(context, new Float32Array([0.2]), 0, controller.signal)
  controller.abort()
  expect(source.stop).toHaveBeenCalledOnce()
  await expect(played).rejects.toThrow('Scripted playback cancelled')
})
