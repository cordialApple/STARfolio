import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-practice-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

const STRONG =
  'When the deploy pipeline kept failing under load I took full ownership, rewrote the retry logic and added caching, and cut our build times from 20 minutes down to 4, which unblocked the entire team ahead of the release.'

test('mode A: scripted session — vague answer drills down, feedback scores all four dimensions', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await win.evaluate(async () => {
    await window.api.bank.create({
      title: 'Deploy pipeline rewrite',
      situation: '',
      task: '',
      action: 'Rewrote CI retry logic and caching',
      result_text: 'Cut build times',
      context: 'work',
      status: 'confirmed',
      skills: [],
      tags: [],
      metrics: []
    })
  })

  await win.getByRole('button', { name: 'Practice', exact: true }).click()
  await win.getByRole('button', { name: 'Start interview' }).click()

  // First question from the interviewer.
  await expect(win.getByText(/tell me about a time/i)).toBeVisible()

  const box = win.getByPlaceholder(/Answer out loud/)

  // Answer 1: deliberately vague → must trigger a drill-down and score all four dimensions.
  await box.fill('It went okay I guess.')
  await win.getByRole('button', { name: 'Answer' }).click()

  await expect(win.getByText('STAR completeness')).toBeVisible()
  await expect(win.getByText('Specificity')).toBeVisible()
  await expect(win.getByText('Measurable result')).toBeVisible()
  await expect(win.getByText('Length')).toBeVisible()
  await expect(win.getByText(/What did you measure there/i)).toBeVisible()

  // Answer 2: strong and quantified → advances with a fresh question, cites the bank.
  await box.fill(STRONG)
  await win.getByRole('button', { name: 'Answer' }).click()
  await expect(win.getByText(/handled a setback/i)).toBeVisible()
  await expect(win.getByText('Deploy pipeline rewrite')).toBeVisible()

  // Answer 3: closes the scripted three-answer session.
  await box.fill(STRONG)
  await win.getByRole('button', { name: 'Answer' }).click()
  await expect(win.getByRole('button', { name: 'New session' })).toBeVisible()

  const persisted = await win.evaluate(async () => {
    const list = await window.api.practice.list()
    const full = await window.api.practice.get(list[0].id)
    const answers = full?.turns.filter((t) => t.role === 'candidate') ?? []
    return {
      sessions: list.length,
      answered: list[0].answered,
      ended: !!list[0].ended_at,
      firstFeedbackDims: answers[0]?.feedback
        ? Object.keys(answers[0].feedback).filter((k) => k !== 'summary').sort()
        : [],
      linkedTitles: answers.flatMap((a) => a.experiences.map((e) => e.title))
    }
  })
  expect(persisted.sessions).toBe(1)
  expect(persisted.answered).toBe(3)
  expect(persisted.ended).toBe(true)
  expect(persisted.firstFeedbackDims).toEqual([
    'length',
    'measurable_result',
    'specificity',
    'star_completeness'
  ])
  expect(persisted.linkedTitles).toContain('Deploy pipeline rewrite')
})
