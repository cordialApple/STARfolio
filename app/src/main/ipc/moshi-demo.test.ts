import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi, type Mock } from 'vitest'
import type { DemoEvent, DemoConditioning } from '../voice/moshi/demo'
import type { MoshiInterviewPorts } from '../ai/moshi-interview'
import type { IpcMain } from 'electron'

type TransportDouble = {
  emit: (event: DemoEvent) => void
  audio: Mock
  condition: Mock
  end: Mock
  start: Mock
}
type BrainDouble = {
  id: string
  appendSegment: Mock
  gap: Mock
  cancel: Mock
  snapshot: Mock
  finish: Mock
  recordConditioningDelivery: Mock
  ports: MoshiInterviewPorts
}

const fake = vi.hoisted(() => ({
  transports: [] as TransportDouble[],
  brains: [] as BrainDouble[],
  health: vi.fn(async () => ({ mode: 'fixture', upstreamReady: true, busy: false })),
  runtime: vi.fn(() => ({})),
  startBrain: vi.fn(),
  loadAudit: vi.fn(),
  compare: vi.fn(async () => ({ verdict: 'fixture-only', agreement: 1 })),
  experimentalRemoteMoshiEnabled: true,
  update: undefined as unknown
}))
vi.mock('./shared', () => ({
  handle: (ipc, channel, schema, fn) =>
    ipc.handle(channel, (event, input) => fn(event, schema.parse(input)))
}))
vi.mock('../store/experience-store', () => ({ getExperienceStore: () => ({ get: vi.fn() }) }))
vi.mock('../ai/runtime', () => ({ interviewRuntime: fake.runtime }))
vi.mock('../ai/moshi-interview', () => ({
  startMoshiInterview: fake.startBrain,
  compareMoshiSessionRigor: fake.compare
}))
vi.mock('../db/repositories/moshi-interview', () => ({ loadMoshiInterview: fake.loadAudit }))
vi.mock('../settings/prefs', () => ({
  getPrefs: () => ({ experimentalRemoteMoshiEnabled: fake.experimentalRemoteMoshiEnabled })
}))
vi.mock('../voice/moshi/demo', () => ({
  checkDemoHealth: fake.health,
  selectDemoEvidence: () => [{ id: 'bank', title: 'Sample', text: 'Synthetic evidence' }],
  MoshiDemoSession: class {
    audio = vi.fn()
    condition = vi.fn()
    end = vi.fn(() => this.emit({ type: 'ended', reason: 'ended' }))
    constructor(public emit: (event: DemoEvent) => void) {
      fake.transports.push(this)
    }
    start = vi.fn(async () => 'fixture')
  }
}))

import { registerMoshiDemo } from './moshi-demo'

const context: DemoConditioning = {
  revision: 1,
  roadmap: { topics: [], objectives: [] },
  action: { intent: { kind: 'ask_intro' }, authority: 'command' }
}
const request = {
  sessionId: 'first',
  endpoint: 'ws://127.0.0.1:8765/session',
  experienceIds: ['bank'],
  durationSeconds: 60,
  consent: true,
  resumeText: 'Candidate built checkout service',
  jobDescription: 'Backend engineer'
}

function harness() {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
  registerMoshiDemo({
    handle: (name, fn) => handlers.set(name, fn),
    on: (name, fn) => handlers.set(name, fn)
  } as unknown as IpcMain)
  const owner = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    send: vi.fn()
  })
  return {
    owner,
    call: (name: string, input: unknown = request, sender = owner) =>
      handlers.get(`moshiDemo:${name}`)!({ sender }, input)
  }
}

beforeEach(() => {
  fake.transports.length = 0
  fake.brains.length = 0
  fake.health.mockResolvedValue({ mode: 'fixture', upstreamReady: true, busy: false })
  fake.experimentalRemoteMoshiEnabled = true
  fake.startBrain.mockImplementation(async (_input, _runtime, ports) => {
    const brain = {
      recordConditioningDelivery: vi.fn(),
      id: 'persisted-id',
      appendSegment: vi.fn(),
      gap: vi.fn(async () => {}),
      cancel: vi.fn(),
      snapshot: vi.fn(() => ({ id: 'persisted-id', status: 'active', report: null })),
      finish: vi.fn(async () => ({
        id: 'persisted-id',
        status: 'finished',
        report: { overallFeedback: 'Grounded report' }
      })),
      ports
    }
    fake.brains.push(brain)
    ports.onConditioning(context)
    return brain
  })
})

it.each([
  ['health', { endpoint: request.endpoint }],
  ['start', request],
  ['rigor', { sessionId: 'stored' }]
])('blocks %s while the remote experiment is disabled', async (name, input) => {
    fake.experimentalRemoteMoshiEnabled = false
    await expect(harness().call(name, input)).rejects.toThrow('Remote MoshiRAG is disabled')
})

it('keeps saved audits readable while the remote experiment is disabled', async () => {
  fake.experimentalRemoteMoshiEnabled = false
  fake.loadAudit.mockReturnValue({ id: 'stored' })
  expect(harness().call('audit', { sessionId: 'stored' })).toEqual({ id: 'stored' })
})

it('allows an active interview to end after the remote experiment is disabled', async () => {
  const h = harness()
  await h.call('start')
  fake.experimentalRemoteMoshiEnabled = false
  await expect(h.call('end', { sessionId: 'first' })).resolves.toBeUndefined()
  expect(fake.brains[0].finish).toHaveBeenCalledOnce()
})

it('starts existing brain with resume and selected evidence before opening the mouth', async () => {
  const h = harness()
  await h.call('start')
  expect(fake.startBrain).toHaveBeenLastCalledWith(
    expect.objectContaining({
      resumeText: request.resumeText,
      jobDescription: request.jobDescription,
      experiences: [{ id: 'bank', title: 'Sample', summary: 'Synthetic evidence' }]
    }),
    expect.objectContaining({ architect: { stub: true }, evaluator: { stub: true } }),
    expect.any(Object)
  )
  expect(fake.transports[0].start).toHaveBeenCalledWith(
    request.endpoint,
    expect.any(Array),
    60,
    context
  )
})

it('sends actual transcript and gaps to brain, and reducer conditioning back to mouth', async () => {
  const h = harness()
  await h.call('start')
  const segment = {
    speaker: 'candidate' as const,
    text: 'I built the API',
    startMs: 100,
    endMs: 900,
    truncated: false
  }
  fake.transports[0].emit({ type: 'segment', ...segment })
  fake.transports[0].emit({ type: 'gap', atMs: 1000 })
  expect(fake.brains[0].appendSegment).toHaveBeenCalledWith(segment)
  expect(fake.brains[0].gap).toHaveBeenCalledOnce()
  fake.brains[0].ports.onConditioning({ ...context, revision: 2 })
  expect(fake.transports[0].condition).toHaveBeenCalledWith({ ...context, revision: 2 })
})

it('finishes and delivers report before ended, then ignores stale session audio', async () => {
  const h = harness()
  await h.call('start')
  await h.call('end', { sessionId: 'first' })
  expect(fake.brains[0].finish).toHaveBeenCalledOnce()
  const events = h.owner.send.mock.calls.map((call) => call[1])
  const reportAt = events.findIndex((event) => event.type === 'interview' && event.snapshot.report)
  expect(reportAt).toBeGreaterThanOrEqual(0)
  expect(events.findIndex((event) => event.type === 'ended')).toBeGreaterThan(reportAt)
  await h.call('start', { ...request, sessionId: 'second' })
  h.call('audio', { sessionId: 'first', samples: new Float32Array([0.1]) })
  await h.call('end', { sessionId: 'first' })
  expect(fake.transports[1].audio).not.toHaveBeenCalled()
  expect(fake.transports[1].end).not.toHaveBeenCalled()
})

it('preserves abnormal local termination when transport acknowledges ending', async () => {
  const h = harness()
  await h.call('start')
  h.owner.emit('did-start-navigation')
  await vi.waitFor(() =>
    expect(fake.brains[0].finish).toHaveBeenCalledWith('Window closed or reloaded')
  )
})

it('marks worker-first termination incomplete before persisting', async () => {
  const h = harness()
  await h.call('start')
  fake.transports[0].emit({ type: 'ended', reason: 'Session time limit reached' })
  await vi.waitFor(() =>
    expect(fake.brains[0].finish).toHaveBeenCalledWith(
      'Remote session ended before local audio drain; transcript incomplete: Session time limit reached'
    )
  )
})

it('accepts an explicit transcript drain failure reason', async () => {
  const h = harness()
  await h.call('start')
  await h.call('end', {
    sessionId: 'first',
    reason: 'Final transcript flush failed'
  })
  expect(fake.brains[0].finish).toHaveBeenCalledWith('Final transcript flush failed')
})

it('reserves owner while roadmap loads and cancels start after window closes', async () => {
  let resolve!: (brain: unknown) => void
  fake.startBrain.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const h = harness()
  const starting = h.call('start')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  await expect(h.call('start')).rejects.toThrow('active interview')
  h.owner.emit('destroyed')
  const brain = { cancel: vi.fn(), snapshot: vi.fn(), finish: vi.fn() }
  resolve(brain)
  await expect(starting).rejects.toThrow('ended')
  expect(brain.cancel).toHaveBeenCalledOnce()
  expect(fake.transports).toHaveLength(0)
})

it('refuses unavailable worker before spending architect calls', async () => {
  fake.health.mockResolvedValueOnce({ mode: 'moshi', upstreamReady: false, busy: false })
  fake.startBrain.mockClear()
  await expect(harness().call('start')).rejects.toThrow('ready')
  expect(fake.startBrain).not.toHaveBeenCalled()
})

it('compares saved fixture answers without paid evaluator calls', async () => {
  const snapshot = { id: 'stored', status: 'finished', mode: 'stub', evaluations: [{}] }
  fake.loadAudit.mockReturnValue(snapshot)
  const h = harness()
  await expect(h.call('rigor', { sessionId: 'stored' })).resolves.toEqual({
    verdict: 'fixture-only',
    agreement: 1
  })
  expect(fake.compare).toHaveBeenLastCalledWith(snapshot, { stub: true })
})

it('rejects rigor replay until the interview finishes', async () => {
  fake.loadAudit.mockReturnValue({ id: 'stored', status: 'active', mode: 'stub' })
  await expect(harness().call('rigor', { sessionId: 'stored' })).rejects.toThrow('finished')
})
