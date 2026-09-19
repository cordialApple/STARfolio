import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

let app: ElectronApplication
let server: Server
let sockets: WebSocketServer
let endpoint: string
const conditioning: Array<{ revision: number; action: { intent: { kind: string } } }> = []
const resumeText = 'Synthetic candidate built a checkout service.'

async function enableRemoteInterviewThroughSettings(page: Page): Promise<void> {
  await page.evaluate(() => window.api.prefs.set({ experimentalRemoteMoshiEnabled: false }))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Voice', exact: true }).click()
  const toggle = page.getByRole('switch', {
    name: 'Enable experimental remote MoshiRAG interviews'
  })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.api.prefs.get()).experimentalRemoteMoshiEnabled)
    )
    .toBe(true)
}

async function enableRemoteInterview(page: Page): Promise<void> {
  await page.evaluate(() => window.api.prefs.set({ experimentalRemoteMoshiEnabled: true }))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
}

async function openInterviewWithResume(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Interview', exact: true }).click()
  await page.getByPlaceholder('Paste your resume, or drop a .txt/.md file here…').fill(resumeText)
}

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({ mode: 'fixture', interviewProtocol: 1, upstreamReady: true, busy: false })
    )
  })
  sockets = new WebSocketServer({ server })
  sockets.on('connection', (socket) => {
    const send = (value: object) => socket.send(JSON.stringify(value))
    socket.on('message', (data, binary) => {
      if (binary) throw new Error('Fixture must never capture microphone audio')
      const event = JSON.parse(data.toString())
      if (event.type === 'start') {
        conditioning.push(event.conditioning)
        send({ type: 'ready', mode: 'fixture' })
        send({ type: 'conditioning', revision: event.conditioning.revision, status: 'consumed' })
        send({
          type: 'segment',
          speaker: 'interviewer',
          text: 'Introduce yourself.',
          startMs: 0,
          endMs: 400,
          truncated: false
        })
        send({
          type: 'segment',
          speaker: 'candidate',
          text: 'I work on checkout services.',
          startMs: 500,
          endMs: 1500,
          truncated: false
        })
        send({ type: 'gap', atMs: 1600 })
      } else if (event.type === 'conditioning') {
        conditioning.push(event.context)
        send({ type: 'conditioning', revision: event.context.revision, status: 'consumed' })
        if (event.context.revision === 2) {
          send({
            type: 'segment',
            speaker: 'interviewer',
            text: 'Tell me about Synthetic checkout. Explain the architecture and your decisions.',
            startMs: 2000,
            endMs: 2500,
            truncated: true
          })
          send({
            type: 'segment',
            speaker: 'candidate',
            text: 'I designed the checkout API because retries caused duplicate charges. My goal was safer payments. I chose idempotency keys instead of disabling retries. I owned the database schema and added a transaction boundary. When a bug caused failures I led the rollback, tested the repair, and built alerts to detect another incident.',
            startMs: 2400,
            endMs: 8500,
            truncated: false
          })
          send({ type: 'gap', atMs: 8700 })
        }
      } else if (event.type === 'end') {
        send({
          type: 'segment',
          speaker: 'interviewer',
          text: 'Thank you for explaining.',
          startMs: 9000,
          endMs: 9500,
          truncated: true
        })
        send({ type: 'ended', reason: 'fixture finished' })
      } else if (event.type === 'ping') send({ type: 'pong' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `ws://127.0.0.1:${(server.address() as { port: number }).port}/session`
  const profile = mkdtempSync(join(tmpdir(), 'starfolio-moshi-loop-'))
  app = await electron.launch({
    ...(process.env.STARFOLIO_TEST_PACKAGED === '1'
      ? {
          executablePath: resolve('./dist/win-unpacked/STARfolio.exe'),
          args: [`--user-data-dir=${profile}`]
        }
      : { args: [resolve('./out/main/index.js'), `--user-data-dir=${profile}`] }),
    env: {
      ...process.env,
      STARFOLIO_AI_STUB: '1',
      STARFOLIO_EMBED_STUB: '1',
      STARFOLIO_E2E: '1',
      PERSONALSERVER_CONFIG_FILE: join(profile, 'recall-config.json')
    }
  })
})
test.afterAll(async () => {
  await app?.close()
  for (const socket of sockets.clients) socket.terminate()
  await new Promise<void>((resolve) => sockets.close(() => resolve()))
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('native duplex shares interview setup and retains cascade mode', async () => {
  const page = await app.firstWindow()
  conditioning.length = 0
  await enableRemoteInterviewThroughSettings(page)
  await openInterviewWithResume(page)
  await page.getByRole('button', { name: 'Native duplex (remote MoshiRAG)', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Native duplex interview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AWS demo', exact: true })).toHaveCount(0)
  await page.getByText('Resume for this interview', { exact: true }).click()
  await expect(page.getByText(resumeText, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to interview setup' }).click()
  await expect(page.getByRole('button', { name: 'Start interview', exact: true })).toBeVisible()
})

test('fixture closes roadmap scoring steering report and persisted audit loop', async () => {
  const page = await app.firstWindow()
  conditioning.length = 0
  await enableRemoteInterview(page)
  await openInterviewWithResume(page)
  await page.evaluate(async () => {
    await window.api.bank.create({
      title: 'Synthetic checkout',
      situation: 'Duplicate charges',
      task: 'Fix retries',
      action: 'Added idempotency keys',
      result_text: 'Safer checkout',
      context: 'project',
      status: 'confirmed',
      skills: [],
      tags: [],
      metrics: []
    })
  })
  await page.getByRole('button', { name: 'Native duplex (remote MoshiRAG)', exact: true }).click()
  await page.getByLabel('Local tunnel endpoint').fill(endpoint)
  await page.getByLabel('Job description', { exact: true }).fill('Build reliable backend services')
  await page.getByLabel('Synthetic checkout').check()
  await page.getByLabel(/Send microphone audio, selected evidence/).check()
  await page.getByRole('button', { name: 'Start native interview' }).click()
  await expect(page.getByText(/1 scored segment groups/)).toBeVisible({ timeout: 15000 })
  await expect.poll(() => conditioning.length).toBeGreaterThanOrEqual(3)
  expect(conditioning[0].action.intent.kind).toBe('ask_intro')
  await page.getByRole('button', { name: 'End interview', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Interview report', exact: true })).toBeVisible()
  await expect(page.getByText('Thank you for explaining.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Compare scoring', exact: true }).click()
  await expect(page.getByText(/Scoring comparison: fixture-only/)).toBeVisible()
  const audit = await page.evaluate(async () => {
    const sessions = await window.api.interview.list()
    const id = sessions[0].id
    return {
      saved: await window.api.interview.get(id),
      audit: await window.api.moshiDemo.audit(id)
    }
  })
  expect(audit.saved?.report).toBeTruthy()
  expect(audit.audit?.evaluations).toHaveLength(1)
  expect(audit.audit?.evaluations[0].input.answer).toContain('idempotency')
  expect(audit.audit?.evaluations[0].input.answer).not.toContain('Tell me about Synthetic checkout')
  expect(audit.audit?.evaluations[0].overlap).toBe(true)
  expect(audit.audit?.commandConformance).toBe('unverified')
  expect(audit.audit?.conditioning.some((item) => item.delivery === 'consumed')).toBe(true)
  expect(audit.audit?.transcript.at(-1)?.text).toBe('Thank you for explaining.')
  await page.screenshot({ path: resolve('./out/native-interview-fixture.png'), fullPage: true })
  await page.getByRole('button', { name: 'Open interview history' }).click()
  await expect(
    page.getByRole('heading', { name: /History|Past interviews|Interview history/i })
  ).toBeVisible()
})
