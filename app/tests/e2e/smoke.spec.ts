import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

// Prefer the true packaged binary (proves asar-unpack native loading — the 0.2 checkpoint).
// Fall back to the electron-vite build output when packaging is unavailable locally
// (e.g. Windows without Developer Mode can't extract electron-builder's winCodeSign symlinks).
// CI on windows-latest always exercises the packaged path.
const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-e2e-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_WHISPER_MODEL: 'tiny.en' }
  if (existsSync(PACKAGED_EXE)) {
    app = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env
    })
  } else {
    app = await electron.launch({
      args: [BUILT_MAIN, `--user-data-dir=${userDataDir}`],
      env
    })
  }
})

test.afterAll(async () => {
  await app?.close()
})

test('packaged app launches and shows title', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  expect(await win.title()).toBe('STARfolio')
})

test('sqlite-vec + FTS5 work inside the packaged app', async () => {
  const win = await app.firstWindow()
  const result = await win.evaluate(async () => window.api.db.selfTest())
  expect(result.ok).toBe(true)
  expect(result.fts).toBeGreaterThan(0)
  expect(result.knn).toBeGreaterThan(0)
})

test('embeddings: bge-small in a worker + sqlite-vec KNN roundtrip', async () => {
  test.setTimeout(180000) // first run downloads the ~34 MB model to userData
  const win = await app.firstWindow()
  const result = await win.evaluate(async () => window.api.embed.selfTest())
  expect(result.dims).toBe(384)
  expect(result.knn).toBeGreaterThan(0)
  expect(result.ok).toBe(true)
})

test('voice: transcribe a WAV fixture via the smart-whisper worker', async () => {
  test.setTimeout(300000) // first run downloads the whisper model
  const wav = readFileSync(resolve('./tests/fixtures/sample-16k.wav'))
  const pcm: number[] = []
  for (let i = 44; i + 1 < wav.length; i += 2) pcm.push(wav.readInt16LE(i))
  const win = await app.firstWindow()
  const text = await win.evaluate((data) => window.api.voice.transcribe(data), pcm)
  // A synthetic tone yields no words; the point is that model load + native binding + the
  // worker round-trip complete and return a string without throwing (no audio hardware needed).
  expect(typeof text).toBe('string')
})

test('AI stream plumbing delivers tokens then done (stub transport)', async () => {
  const win = await app.firstWindow()
  const streamed = await win.evaluate(
    () =>
      new Promise<{ text: string; done: boolean }>((res, rej) => {
        const timer = setTimeout(() => rej(new Error('stream timeout')), 10000)
        let text = ''
        const activeId = crypto.randomUUID()
        window.api.ai.onToken((id, t) => {
          if (id === activeId) text += t
        })
        window.api.ai.onDone((id) => {
          if (id === activeId) {
            clearTimeout(timer)
            res({ text, done: true })
          }
        })
        window.api.ai.onError((id, m) => {
          if (id === activeId) {
            clearTimeout(timer)
            rej(new Error(m))
          }
        })
        window.api.ai.stream('ping', activeId)
      })
  )
  expect(streamed.done).toBe(true)
  expect(streamed.text).toContain('stub reply to: ping')
})
