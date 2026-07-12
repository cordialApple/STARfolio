import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-materials-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1', STARFOLIO_E2E: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('materials: a JD drafts resume bullets, each traceable to a banked experience', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  const res = await win.evaluate(async () => {
    await window.api.bank.create({
      title: 'Billing migration',
      situation: 'Invoices took six hours to generate.',
      task: 'I owned getting that down.',
      action: 'Rebuilt the billing pipeline with caching and parallel jobs.',
      result_text: 'Cut invoice generation from six hours to twenty minutes.',
      context: 'work',
      status: 'confirmed',
      skills: [],
      tags: [],
      metrics: []
    })
    const matches = await window.api.bank.search({ query: 'backend billing engineer', status: 'confirmed' })
    const ids = matches.map((m) => m.id)
    const bullets = await window.api.materials.bullets(
      'We need a backend engineer to own our billing platform.',
      ids
    )
    return {
      count: bullets.length,
      allTraceable: bullets.every((b) => !!b.experienceId && !!b.experienceTitle),
      firstTitle: bullets[0]?.experienceTitle
    }
  })

  expect(res.count).toBeGreaterThan(0)
  // Checkpoint 10: every bullet is traceable to a banked experience.
  expect(res.allTraceable).toBe(true)
  expect(res.firstTitle).toBe('Billing migration')
})

test('materials: the Resume tab renders the job-description form', async () => {
  const win = await app.firstWindow()
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Resume', exact: true }).click()

  await expect(win.getByRole('heading', { name: 'Resume bullets' })).toBeVisible()
  await expect(win.getByRole('button', { name: 'Draft bullets' })).toBeVisible()
})
