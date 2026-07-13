import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-voice-'))
  const env = {
    ...process.env,
    STARFOLIO_AI_STUB: '1',
    STARFOLIO_EMBED_STUB: '1',
    STARFOLIO_WHISPER_STUB: '1',
    STARFOLIO_E2E: '1'
  }
  // Fake mic so getUserMedia + the AudioWorklet produce a (tone) stream headlessly.
  const fakeMedia = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  const args = [`--user-data-dir=${userDataDir}`, ...fakeMedia]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('voice: whisper transcribe stub + model manager over IPC', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  const result = await win.evaluate(async () => {
    const text = await window.api.voice.transcribe([1, 2, 3, 4, 5])
    const models = await window.api.voice.models()
    return {
      text,
      names: models.map((m) => m.name),
      sizes: models.map((m) => m.sizeMB),
      baseInstalled: models.find((m) => m.name === 'base.en')?.downloaded
    }
  })
  expect(result.text).toContain('stub transcript')
  expect(result.names).toEqual(['tiny.en', 'base.en', 'small.en'])
  expect(result.sizes.every((s) => s > 0)).toBe(true)
  expect(result.baseInstalled).toBe(true)
})

// The actual mic capture → transcript path (getUserMedia + AudioWorklet in the packaged app) is
// verified by the manual voice checkpoint; here we assert the voice UI + model gating are wired.
test('voice: model manager in settings + push-to-talk gating in the practice flow', async () => {
  const win = await app.firstWindow()

  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('button', { name: 'Voice', exact: true }).click()
  // Under the whisper stub base.en reports installed, which enables push-to-talk.
  await expect(win.getByText('Installed')).toBeVisible()

  await win.getByRole('button', { name: 'Practice', exact: true }).click()
  await win.getByRole('button', { name: 'Start interview' }).click()
  await expect(win.getByText(/tell me about a time/i)).toBeVisible()

  // Model ready (base.en from prefs default) → the hold-to-talk mic is offered alongside the editable answer box.
  await expect(win.getByRole('button', { name: /Hold to talk/i })).toBeVisible()
  await expect(win.getByPlaceholder(/Speak with the mic above/)).toBeVisible()
})
