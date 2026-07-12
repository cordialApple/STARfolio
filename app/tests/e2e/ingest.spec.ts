import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')
const RESUME = resolve('./tests/fixtures/ingest/resume.txt')
const NOTES = resolve('./tests/fixtures/ingest/notes.md')
const SCANNED = resolve('./tests/fixtures/ingest/scanned.pdf')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-ingest-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('import: a document becomes a draft with its source attached and visible on detail', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // The real ingest worker parses the file off the main thread; then the source is
  // linked to a draft exactly as the import wizard does.
  const title = await win.evaluate(async (p) => {
    const results = await window.api.ingest.files([p])
    const src = results[0].source!
    const ext = await window.api.brain.extract(src.raw_text!)
    const exp = await window.api.bank.create({
      title: ext.title,
      situation: ext.situation.text,
      task: ext.task.text,
      action: ext.action.text,
      result_text: ext.result.text,
      context: ext.context,
      status: 'draft',
      skills: [],
      tags: [],
      metrics: [],
      source_id: src.id
    })
    return exp.title
  }, RESUME)

  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByText(title).first().click()

  await expect(win.getByText('Built from')).toBeVisible()
  await expect(win.getByText(/File — resume\.txt/)).toBeVisible()
})

test('import: the wizard offers a drop zone and a url field', async () => {
  const win = await app.firstWindow()
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Import', exact: true }).click()

  await expect(win.getByRole('heading', { name: 'Import documents' })).toBeVisible()
  await expect(win.getByRole('button', { name: 'Choose files' })).toBeVisible()
  await expect(win.getByPlaceholder(/example\.com/)).toBeVisible()
})

test('import: re-importing the same file is flagged as a duplicate', async () => {
  const win = await app.firstWindow()
  const first = await win.evaluate((p) => window.api.ingest.files([p]), NOTES)
  const again = await win.evaluate((p) => window.api.ingest.files([p]), NOTES)
  expect(first[0].ok).toBe(true)
  expect(first[0].duplicate).toBeFalsy()
  expect(again[0].duplicate).toBe(true)
  expect(again[0].source?.id).toBe(first[0].source?.id)
})

test('import: a scanned pdf fails gracefully instead of making an empty draft', async () => {
  const win = await app.firstWindow()
  const results = await win.evaluate((p) => window.api.ingest.files([p]), SCANNED)
  expect(results[0].ok).toBe(false)
  expect(results[0].scanned).toBe(true)
  expect(results[0].error).toMatch(/scanned/i)
})
