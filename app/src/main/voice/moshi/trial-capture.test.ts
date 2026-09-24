import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { TrialCapture } from './trial-capture'

const roots: string[] = []

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'starfolio-trial-'))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('keeps one trial-linked manifest with denominators and monotonic latencies', async () => {
  let now = 100
  const path = root()
  const capture = new TrialCapture({
    root: path,
    sessionId: 'session-1',
    trialId: 'trial-1',
    recordMedia: false,
    now: () => now
  })
  now = 220
  capture.phase('health')
  now = 520
  capture.phase('ready')
  now = 600
  capture.gap()
  now = 725
  capture.output(new Float32Array(240))
  capture.input(new Float32Array(480))
  capture.ping(31)
  now = 900
  await capture.finish('Ended by user', true)
  const data = JSON.parse(readFileSync(join(path, 'session-1', 'manifest.json'), 'utf8'))
  expect(data).toMatchObject({
    schemaVersion: 1,
    sessionId: 'session-1',
    trialId: 'trial-1',
    status: 'finished',
    reason: 'Ended by user',
    mediaRecorded: false,
    phasesMs: { health: 120, ready: 420 },
    gapToAudioMs: [125],
    pingRttMs: [31],
    gapCount: 1,
    inputSamples: 480,
    outputSamples: 240,
    durationMs: 800
  })
  expect(readdirSync(join(path, 'session-1'))).toEqual(['manifest.json'])
})

it('stores PCM only with separate media opt-in and leaves an incomplete manifest on failure', async () => {
  const path = root()
  const capture = new TrialCapture({
    root: path,
    sessionId: 'session-2',
    trialId: 'trial-2',
    recordMedia: true,
    now: () => 0
  })
  capture.input(new Float32Array([0.25, -0.5]))
  capture.output(new Float32Array([0.75]))
  await capture.finish('Gateway disconnected', false)
  const directory = join(path, 'session-2')
  const data = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
  expect(data).toMatchObject({ mediaRecorded: true, status: 'incomplete' })
  expect(readFileSync(join(directory, 'input.f32le')).readFloatLE(0)).toBe(0.25)
  expect(readFileSync(join(directory, 'output.f32le')).readFloatLE(0)).toBe(0.75)
})

it('warns once when asynchronous media writing fails', async () => {
  const path = root()
  const warnings: string[] = []
  const capture = new TrialCapture({
    root: path,
    sessionId: 'session-3',
    trialId: 'trial-3',
    recordMedia: true,
    onMediaError: (message) => warnings.push(message)
  })
  const stream = Reflect.get(capture, 'inputStream') as { destroy: (error: Error) => void }
  stream.destroy(new Error('disk full'))
  await new Promise((resolve) => setTimeout(resolve, 10))
  await capture.finish('Ended by user', true)
  expect(warnings).toEqual(['disk full'])
  const data = JSON.parse(readFileSync(join(path, 'session-3', 'manifest.json'), 'utf8'))
  expect(data).toMatchObject({ status: 'incomplete', mediaError: 'disk full' })
})
