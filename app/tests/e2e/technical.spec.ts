import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')
const CORPUS = resolve('./tests/fixtures/corpus/design-notes.txt')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-technical-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1', STARFOLIO_E2E: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('technical: a corpus-grounded session cites a chunk on every question and follow-up', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  const res = await win.evaluate(async (p) => {
    const added = await window.api.corpus.addFiles([p], 'distributed systems')
    const start = await window.api.technical.start({
      promptText: 'the rate limiter design',
      discipline: 'distributed systems'
    })
    const answer = await window.api.technical.answer(
      start.sessionId,
      'I would use a token bucket in Redis with an atomic Lua refill, and a local in-memory fallback during a partition to stay available.'
    )
    return {
      ok: added[0].ok,
      chunks: added[0].chunks ?? 0,
      question: start.question,
      startCitations: start.citations.length,
      answerCitations: answer.citations.length,
      dims: Object.keys(answer.feedback)
    }
  }, CORPUS)

  expect(res.ok).toBe(true)
  expect(res.chunks).toBeGreaterThan(0)
  // Checkpoint 9: every question and follow-up cites at least one corpus chunk.
  expect(res.startCitations).toBeGreaterThanOrEqual(1)
  expect(res.answerCitations).toBeGreaterThanOrEqual(1)
  // Distinct technical rubric (not the behavioral STAR dimensions).
  expect(res.dims).toEqual(
    expect.arrayContaining(['correctness', 'depth', 'tradeoffs', 'communication', 'summary'])
  )
})

test('technical: the tab shows a start form', async () => {
  const win = await app.firstWindow()
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Technical', exact: true }).click()

  await expect(win.getByText('Start a session')).toBeVisible()
  await expect(win.getByRole('button', { name: 'Start technical interview' })).toBeVisible()
})

test('technical: a live session can copy its transcript once an answer is scored', async () => {
  const win = await app.firstWindow()
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Technical', exact: true }).click()

  await win.getByPlaceholder('e.g. the rate limiter design in my notes').fill('the rate limiter design')
  await win.getByRole('button', { name: 'Start technical interview' }).click()

  await expect(win.getByRole('button', { name: 'Copy session' })).toHaveCount(0)

  await win.getByPlaceholder('Answer the question…').fill(
    'A token bucket in Redis with an atomic Lua refill and a local fallback during partitions.'
  )
  await win.getByRole('button', { name: 'Answer' }).click()

  await win.getByRole('button', { name: 'Copy session' }).click()
  await expect(win.getByText('Session copied to clipboard.')).toBeVisible()
})
