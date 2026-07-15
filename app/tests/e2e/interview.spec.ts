import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')

const RESUME = [
  'Senior backend engineer.',
  'Built a distributed rate limiter in Redis serving 40k rps.',
  'Led migration of a monolith to event-driven services.',
  'Owned the on-call rotation and cut p99 latency by 60%.'
].join('\n')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-interview-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1', STARFOLIO_E2E: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('interview: the adaptive engine runs intro→closing and debriefs at the end', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  const res = await win.evaluate(async (resume) => {
    const start = await window.api.interview.start({ resumeText: resume, level: 'senior' })
    const phases = [start.phase]
    let step = start
    // High elapsedMs forces time pressure so the engine converges to done.
    for (let i = 0; i < 10 && !step.done; i++) {
      step = await window.api.interview.answer(
        step.sessionId,
        'I designed a token-bucket limiter with atomic Lua refill and a local fallback during partitions.',
        29 * 60 * 1000
      )
      phases.push(step.phase)
    }
    const report = await window.api.interview.report(step.sessionId)
    return {
      firstUtterance: start.utterance,
      done: step.done,
      phases,
      report
    }
  }, RESUME)

  expect(res.firstUtterance.length).toBeGreaterThan(0)
  expect(res.done).toBe(true)
  expect(res.phases).toContain('closing')
  expect(res.phases[res.phases.length - 1]).toBe('done')
  expect(res.report).not.toBeNull()
  expect(res.report!.overallFeedback.length).toBeGreaterThan(0)
  expect(Array.isArray(res.report!.strengths)).toBe(true)
  expect(Array.isArray(res.report!.improvementAreas)).toBe(true)
  expect(Array.isArray(res.report!.starStories)).toBe(true)
})

test('interview: the tab shows a resume setup form', async () => {
  const win = await app.firstWindow()
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Interview', exact: true }).click()

  await expect(win.getByText('Set up your interview')).toBeVisible()
  await expect(win.getByRole('button', { name: 'Start interview' })).toBeVisible()
})

test('interview: a persisted session appears in history and opens a read-only debrief', async () => {
  const win = await app.firstWindow()

  await win.evaluate(async (resume) => {
    const start = await window.api.interview.start({
      resumeText: resume,
      candidateName: 'Casey Historian',
      level: 'senior'
    })
    let step = start
    for (let i = 0; i < 10 && !step.done; i++) {
      step = await window.api.interview.answer(
        step.sessionId,
        'I designed a token-bucket limiter with atomic Lua refill and a local fallback during partitions.',
        29 * 60 * 1000
      )
    }
  }, RESUME)

  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Interview', exact: true }).click()
  await win.getByRole('button', { name: 'History' }).click()

  await expect(win.getByText('Interview history')).toBeVisible()
  await win.getByRole('button', { name: /^Casey Historian/ }).click()

  await expect(win.getByText('Your debrief')).toBeVisible()

  await win.getByRole('button', { name: 'Copy debrief' }).click()
  await expect(win.getByText('Debrief copied to clipboard.')).toBeVisible()

  await expect(win.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
})

test('interview: a history entry can be deleted from the list', async () => {
  const win = await app.firstWindow()

  await win.evaluate(async (resume) => {
    await window.api.interview.start({
      resumeText: resume,
      candidateName: 'Dana Deletable',
      level: 'mid'
    })
  }, RESUME)

  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Interview', exact: true }).click()
  await win.getByRole('button', { name: 'History' }).click()

  await win.getByRole('button', { name: /Delete interview with Dana Deletable/ }).click()
  await win.getByRole('button', { name: 'Delete', exact: true }).click()

  await expect(win.getByRole('button', { name: /Dana Deletable/ })).toHaveCount(0)
})
