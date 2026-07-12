import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-capture-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('practice: an unbanked answer can be captured to the bank as a draft', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // Empty bank → the background match finds nothing → the story is new.
  await win.getByRole('button', { name: 'Practice', exact: true }).click()
  await win.getByRole('button', { name: 'Start interview' }).click()
  await expect(win.getByText(/tell me about a time/i)).toBeVisible()

  await win
    .getByPlaceholder(/type here/)
    .fill('I organized a campus hackathon, recruited forty students, and we shipped six projects.')
  await win.getByRole('button', { name: 'Answer' }).click()

  await expect(win.getByText('STAR completeness')).toBeVisible()
  // The background bank check resolves to "not in your bank yet" and offers capture.
  await expect(win.getByText('Not in your bank yet.')).toBeVisible({ timeout: 15000 })

  await win.getByRole('button', { name: 'Capture it' }).click()
  await expect(win.getByText('Saved to your bank as a draft.')).toBeVisible()

  const drafts = await win.evaluate(() => window.api.bank.list({ status: 'draft' }))
  expect(drafts.length).toBe(1)
})
