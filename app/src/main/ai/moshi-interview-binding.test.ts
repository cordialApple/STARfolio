import { expect, it, vi } from 'vitest'
import { startMoshiInterview } from './moshi-interview'
import { emptyCoverage } from './roadmap'
vi.mock('../db/repositories/moshi-interview', () => ({ saveMoshiInterview: vi.fn() }))
vi.mock('../settings/secrets', () => ({ getSecret: vi.fn() }))
vi.mock('./usage', () => ({ logUsage: vi.fn() }))
const input = {
  resumeText: 'Alpha and Beta projects',
  experiences: [
    { id: 'alpha', title: 'Alpha' },
    { id: 'beta', title: 'Beta' }
  ],
  budgetMs: 1000,
  closingReserveMs: 0
}
const runtime = { architect: { stub: true }, evaluator: { stub: true } }
const entry = (speaker: 'candidate' | 'interviewer', text: string, startMs: number) => ({
  speaker,
  text,
  startMs,
  endMs: startMs + 1
})
async function setup(ports = {}) {
  const session = await startMoshiInterview(input, runtime, {
    onConditioning: vi.fn(),
    save: vi.fn(),
    ...ports
  })
  session.recordConditioningDelivery(1, 'consumed')
  session.appendSegment(entry('interviewer', 'Introduce yourself.', 1))
  session.appendSegment(entry('candidate', 'I work on Alpha.', 3))
  await session.gap()
  session.recordConditioningDelivery(2, 'consumed')
  session.appendSegment(entry('interviewer', 'Tell me about Alpha.', 5))
  return session
}
it('does not bind requested transition when continuing speech remains on prior topic', async () => {
  const evaluate = vi.fn(async (answer) => ({
    topicId: answer.topicId,
    coverageDeltas: {
      ...emptyCoverage(),
      motivation: 'explored',
      architecture: 'explored',
      tradeoffs: 'explored',
      failures: 'explored',
      ownership: 'explored'
    },
    candidateDelta: {},
    newThreads: [],
    resolvedThreadIds: []
  }))
  const session = await setup({ evaluate })
  session.appendSegment(entry('candidate', 'My Alpha design.', 7))
  await session.gap()
  expect(session.snapshot().conditioning.at(-1)?.action.intent).toMatchObject({
    kind: 'transition',
    topicId: 'beta'
  })
  session.recordConditioningDelivery(3, 'rejected')
  session.appendSegment(entry('candidate', 'More on Alpha.', 9))
  await session.gap()
  expect(evaluate.mock.calls.map(([answer]) => answer.topicId)).toEqual(['alpha', 'alpha'])
})
it('queued old exploration answer cannot finish unrealized closing', async () => {
  let now = 0
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const evaluate = vi.fn(async (answer) => {
    await blocked
    return {
      topicId: answer.topicId,
      coverageDeltas: {},
      candidateDelta: {},
      newThreads: [],
      resolvedThreadIds: []
    }
  })
  const session = await setup({ now: () => now, evaluate })
  session.appendSegment(entry('candidate', 'Alpha first answer.', 7))
  const first = session.gap()
  await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce())
  session.appendSegment(entry('candidate', 'Alpha continuation.', 9))
  const second = session.gap()
  now = 1000
  release()
  await Promise.all([first, second])
  expect(session.snapshot().state.phase).toBe('closing')
  expect(session.snapshot().conditioning.at(-1)?.action.intent.kind).toBe('closing')
  expect(session.snapshot().evaluations).toHaveLength(2)
})

it('keeps unknown observed question unattributed even when transition consumed', async () => {
  const session = await setup()
  session.appendSegment(entry('interviewer', 'Let us discuss an unrelated topic.', 6))
  session.appendSegment(entry('candidate', 'My unrelated answer.', 9))
  await session.gap()
  expect(session.snapshot().evaluations).toHaveLength(1)
  session.recordConditioningDelivery(session.snapshot().conditioning.at(-1)!.revision, 'consumed')
  session.appendSegment(entry('interviewer', 'What is the weather?', 11))
  session.appendSegment(entry('candidate', 'It is raining.', 13))
  await session.gap()
  expect(session.snapshot().evaluations).toHaveLength(1)
  expect(session.snapshot().unattributed).toHaveLength(1)
})

it('binds identifiable overlapping question and excludes later question from earlier answer', async () => {
  const session = await setup()
  session.appendSegment({
    speaker: 'interviewer',
    text: 'Alpha architecture?',
    startMs: 6,
    endMs: 10,
    truncated: true
  })
  session.appendSegment(entry('interviewer', 'Now discuss Beta.', 20))
  session.appendSegment({ speaker: 'candidate', text: 'I built Alpha.', startMs: 8, endMs: 15 })
  await session.gap()
  const audit = session.snapshot().evaluations[0]
  expect(audit.input.topicId).toBe('alpha')
  expect(audit.input.question).not.toContain('Beta')
  expect(audit.overlap).toBe(true)
})

it('marks incomplete termination in saved audit and report', async () => {
  const session = await setup()
  session.appendSegment(entry('candidate', 'I built Alpha.', 7))
  await session.gap()
  const result = await session.finish('flush-incomplete')
  expect(result.transcriptIntegrity).toBe('incomplete')
  expect(result.terminationReason).toBe('flush-incomplete')
  expect(result.report?.overallFeedback).toContain('Transcript incomplete')
})

it.each([
  'Final transcript flush timed out',
  'Gateway heartbeat lost',
  'deadline-expired',
  'heartbeat-expired',
  'Remote session ended before local audio drain; transcript incomplete: time limit reached'
])(
  'marks abnormal ending incomplete: %s',
  async (reason) => {
    const session = await setup()
    const result = await session.finish(reason)
    expect(result.transcriptIntegrity).toBe('incomplete')
  }
)

it('persists incomplete integrity when the window closes or reloads', async () => {
  const save = vi.fn()
  const session = await setup({ save })
  const result = await session.finish('Window closed or reloaded')
  expect(result.transcriptIntegrity).toBe('incomplete')
  expect(result.terminationReason).toBe('Window closed or reloaded')
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: 'finished',
      transcriptIntegrity: 'incomplete',
      terminationReason: 'Window closed or reloaded'
    })
  )
})

it('preserves prior context through a short backchannel', async () => {
  const session = await setup()
  session.appendSegment(entry('candidate', 'I built Alpha.', 7))
  await session.gap()
  session.appendSegment(entry('interviewer', 'mhm', 9))
  session.appendSegment(entry('candidate', 'My Alpha implementation continued.', 11))
  await session.gap()
  expect(session.snapshot().evaluations).toHaveLength(2)
  expect(session.snapshot().unattributed).toHaveLength(0)
  expect(session.snapshot().evaluations[1].input.question).toBe(
    session.snapshot().evaluations[0].input.question
  )
})
