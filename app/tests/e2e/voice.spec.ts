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
    STARFOLIO_WHISPER_STUB: '1'
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

test('voice: push-to-talk records → transcript fills the answer box', async () => {
  const win = await app.firstWindow()

  await win.getByRole('button', { name: 'Practice', exact: true }).click()
  await expect(win.getByRole('heading', { name: 'Voice (optional)' })).toBeVisible()
  await expect(win.getByText('Installed')).toBeVisible()

  await win.getByRole('button', { name: 'Start interview' }).click()
  await expect(win.getByText(/tell me about a time/i)).toBeVisible()

  const mic = win.getByRole('button', { name: /Hold to talk/i })
  await expect(mic).toBeVisible()

  // Hold to record a moment of the fake-device tone, then release to transcribe.
  await mic.dispatchEvent('pointerdown')
  await win.waitForTimeout(600)
  await mic.dispatchEvent('pointerup')

  const box = win.getByPlaceholder(/Speak with the mic above/)
  await expect(box).toHaveValue(/stub transcript/, { timeout: 15000 })

  // The transcript is editable, then sends as a normal turn.
  await win.getByRole('button', { name: 'Answer' }).click()
  await expect(win.getByText('STAR completeness')).toBeVisible()
})
