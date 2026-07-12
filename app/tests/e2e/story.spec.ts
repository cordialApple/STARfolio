import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-story-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('mode B: seeded bank → JD paste → grounded story cites the expected experience', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // Seed a confirmed bank. The target experience carries the JD's keywords so FTS retrieves it
  // deterministically; the distractors do not.
  await win.evaluate(async () => {
    const base = {
      task: '',
      happened_start: null,
      happened_end: null,
      status: 'confirmed' as const,
      skills: [],
      tags: [],
      metrics: []
    }
    await window.api.bank.create({
      ...base,
      title: 'Scaled the checkout service',
      situation: 'Checkout was flaky under load',
      action: 'Rewrote the payments retry to improve reliability',
      result_text: 'Error rates dropped sharply',
      context: 'work'
    })
    await window.api.bank.create({
      ...base,
      title: 'Mentored two interns',
      situation: 'Two new interns joined',
      action: 'Paired daily and wrote onboarding docs',
      result_text: 'Both shipped features by week three',
      context: 'work'
    })
    await window.api.bank.create({
      ...base,
      title: 'Redesigned the dashboard',
      situation: 'The dashboard was cluttered',
      action: 'Built accessible React components',
      result_text: 'Task completion went up',
      context: 'project'
    })
  })

  await win.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(win.getByRole('heading', { name: 'Generate a story' })).toBeVisible()

  await win
    .getByPlaceholder(/Paste the job description/)
    .fill('We need an engineer to own payments reliability')
  await win.getByRole('button', { name: 'Find experiences' }).click()

  // The keyword-matched experience is retrieved and pre-selected.
  const targetRow = win.getByText('Scaled the checkout service')
  await expect(targetRow).toBeVisible()
  await expect(win.getByLabel('Include Scaled the checkout service')).toBeChecked()

  await win.getByRole('button', { name: 'Generate story' }).click()

  // Provenance: the story is built from the expected experience (the "Built from" chip,
  // whose text is exactly the title — distinct from the candidate row that contains more).
  await expect(win.getByText('Built from')).toBeVisible()
  await expect(
    win.getByRole('listitem').filter({ hasText: /^Scaled the checkout service$/ })
  ).toBeVisible()

  // The stream finishes; save persists the story with its provenance links.
  await win.getByRole('button', { name: 'Save' }).click()
  await expect(win.getByRole('button', { name: 'Saved' })).toBeVisible()

  const persisted = await win.evaluate(async () => {
    const list = await window.api.story.list()
    const full = await window.api.story.get(list[0].id)
    return {
      count: list.length,
      titles: full?.experiences.map((e) => e.title),
      hasContent: (full?.content.length ?? 0) > 0,
      promptText: full?.prompt.promptText
    }
  })
  expect(persisted.count).toBe(1)
  expect(persisted.hasContent).toBe(true)
  expect(persisted.promptText).toBe('We need an engineer to own payments reliability')
  expect(persisted.titles).toContain('Scaled the checkout service')
})
