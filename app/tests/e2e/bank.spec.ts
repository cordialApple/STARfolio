import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-bank-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('bank flow: create, filter, edit, confirm — and it persists', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await expect(win.getByText('Your bank is empty')).toBeVisible()

  await win.getByRole('button', { name: 'New experience' }).click()
  await win.locator('#exp-title').fill('Cut the deploy time')
  await win.locator('#exp-situation').fill('Deploys took forty minutes and blocked everyone.')
  await win.locator('#exp-task').fill('I owned getting that number down.')
  await win.locator('#exp-action').fill('Rebuilt the pipeline with caching and parallel jobs.')
  await win.locator('#exp-result_text').fill('Deploys dropped to eight minutes.')
  await win.getByPlaceholder('Add a skill and press Enter').fill('CI/CD')
  await win.getByPlaceholder('Add a skill and press Enter').press('Enter')
  await win.getByPlaceholder('Add a tag and press Enter').fill('infra')
  await win.getByPlaceholder('Add a tag and press Enter').press('Enter')

  await win.getByRole('button', { name: 'Confirm' }).click()

  const heading = win.getByRole('heading', { name: 'Cut the deploy time' })
  await expect(heading).toBeVisible()
  await expect(win.getByText('Confirmed', { exact: true })).toBeVisible()

  await win.getByRole('button', { name: 'Back to bank' }).click()
  await expect(win.getByRole('heading', { name: 'Cut the deploy time' })).toBeVisible()

  const search = win.getByRole('searchbox', { name: 'Search experiences' })
  await search.fill('deploy')
  await expect(win.getByRole('heading', { name: 'Cut the deploy time' })).toBeVisible()
  await search.fill('')

  // Hybrid search always returns nearest matches, so the empty state is a structured-filter
  // concern: filter to drafts and the lone confirmed experience drops out.
  await win.getByLabel('Filter by status').selectOption('draft')
  await expect(win.getByText('No matches')).toBeVisible()
  await win.getByLabel('Filter by status').selectOption('')

  await win.getByRole('button', { name: /Cut the deploy time/ }).click()
  await win.getByRole('button', { name: 'Edit' }).click()
  await win.locator('#exp-title').fill('Cut the deploy time by 5x')
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(win.getByRole('heading', { name: 'Cut the deploy time by 5x' })).toBeVisible()

  const reopened = await win.evaluate(async () => {
    const list = await window.api.bank.list({})
    return { count: list.length, title: list[0]?.title, status: list[0]?.status }
  })
  expect(reopened).toEqual({ count: 1, title: 'Cut the deploy time by 5x', status: 'confirmed' })
})
