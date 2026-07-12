import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-brain-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('brain dump: paste → propose → confirm, with the source attached', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await win.getByRole('button', { name: 'Brain dump' }).click()
  await win
    .getByPlaceholder(/Last spring the checkout page/)
    .fill('Rewrote the deploy pipeline to cut build times')
  await win.getByRole('button', { name: 'Draft with AI' }).click()

  await expect(win.getByRole('heading', { name: 'Review the draft' })).toBeVisible()
  // The stub seeds the title from the pasted notes; the review form is pre-filled.
  await expect(win.locator('#exp-title')).toHaveValue(/Rewrote the deploy pipeline/)

  // Fill the beats the stub left as gaps, then confirm.
  await win.locator('#exp-task').fill('I owned bringing build times down.')
  await win.locator('#exp-result_text').fill('Builds dropped from twenty minutes to four.')
  await win.getByRole('button', { name: 'Confirm' }).click()

  await expect(
    win.getByRole('heading', { name: 'Rewrote the deploy pipeline to cut build times' })
  ).toBeVisible()
  await expect(win.getByText('Built from')).toBeVisible()

  const saved = await win.evaluate(async () => {
    const list = await window.api.bank.list({})
    const full = await window.api.bank.get(list[0].id)
    return {
      count: list.length,
      status: full?.status,
      sourceKind: full?.sources[0]?.kind,
      sourceText: full?.sources[0]?.raw_text
    }
  })
  expect(saved).toEqual({
    count: 1,
    status: 'confirmed',
    sourceKind: 'paste',
    sourceText: 'Rewrote the deploy pipeline to cut build times'
  })
})
