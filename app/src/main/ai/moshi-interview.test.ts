import { describe, expect, it, vi } from 'vitest'
import { startMoshiInterview, compareMoshiRigor } from './moshi-interview'
import { evaluateAnswer, type EvaluatorInput } from './roles/evaluator'
vi.mock('../db/repositories/moshi-interview', () => ({ saveMoshiInterview: vi.fn() }))
vi.mock('../settings/secrets', () => ({ getSecret: vi.fn() }))
vi.mock('./usage', () => ({ logUsage: vi.fn() }))
const runtime = { architect: { stub: true }, evaluator: { stub: true } }
const input = {
  resumeText: 'I built checkout services.',
  experiences: [{ id: 'checkout', title: 'Checkout' }]
}
const segment = (
  text: string,
  startMs = 100,
  speaker: 'candidate' | 'interviewer' = 'candidate'
) => ({ speaker, text, startMs, endMs: startMs + 100, truncated: false })
async function createRaw(ports = {}) {
  return startMoshiInterview(input, runtime, { onConditioning: vi.fn(), save: vi.fn(), ...ports })
}
async function create(ports = {}) {
  const session = await createRaw(ports)
  session.recordConditioningDelivery(1, 'consumed')
  session.appendSegment({ ...segment('Introduce yourself.', 0, 'interviewer'), endMs: 1 })
  session.appendSegment({ ...segment('Introduction.', 2), endMs: 3 })
  await session.gap()
  session.recordConditioningDelivery(2, 'consumed')
  session.appendSegment({ ...segment('Tell me about Checkout.', 4, 'interviewer'), endMs: 5 })
  return session
}
describe('native duplex interview brain', () => {
  it('emits architect roadmap and directed intent without a fabricated utterance', async () => {
    const onConditioning = vi.fn()
    const session = await createRaw({ onConditioning })
    expect(onConditioning.mock.calls[0][0]).toMatchObject({
      revision: 1,
      action: { intent: { kind: 'ask_intro' }, authority: 'command' }
    })
    expect(session.snapshot().transcript).toEqual([])
    expect(session.snapshot().mode).toBe('stub')
    expect(session.snapshot().commandConformance).toBe('unverified')
  })
  it('scores actual candidate text once per gap and retains overlap and truncation', async () => {
    const session = await create()
    session.appendSegment({ ...segment('Tell me what you built.', 10, 'interviewer'), endMs: 40 })
    session.appendSegment({
      ...segment('I built the service because checkout failed.', 50),
      truncated: true
    })
    session.appendSegment({ ...segment('Go on.', 60, 'interviewer'), endMs: 70 })
    await session.gap()
    await session.gap()
    const snapshot = session.snapshot()
    expect(snapshot.evaluations).toHaveLength(1)
    expect(snapshot.evaluations[0].input.answer).toBe(
      'I built the service because checkout failed.'
    )
    expect(snapshot.evaluations[0].input.question).toBe(
      'Tell me about Checkout. Tell me what you built.'
    )
    expect(snapshot.evaluations[0]).toMatchObject({
      truncated: true,
      overlap: true,
      topicAttribution: 'observed-question'
    })
    expect(snapshot.evaluations[0].evaluation.coverageDeltas.architecture).toBe('partial')
    expect(snapshot.conditioning).toHaveLength(3)
  })
  it('keeps scorer single flight and preserves later candidate segments', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const evaluator = vi.fn(async (answer: EvaluatorInput) => {
      await blocked
      return evaluateAnswer(answer, { stub: true })
    })
    const session = await create({ evaluate: evaluator })
    session.appendSegment(segment('I built the API.'))
    const first = session.gap()
    session.appendSegment(segment('My bug caused an outage.', 400))
    const second = session.gap()
    await vi.waitFor(() => expect(evaluator).toHaveBeenCalledTimes(1))
    release()
    await Promise.all([first, second])
    expect(evaluator).toHaveBeenCalledTimes(2)
    expect(session.snapshot().evaluations.map((entry) => entry.input.answer)).toEqual([
      'I built the API.',
      'My bug caused an outage.'
    ])
  })
  it('finishes pending evidence and returns existing report plus coverage audit', async () => {
    const session = await create()
    session.appendSegment(segment('I built the API because users needed faster checkout.'))
    const result = await session.finish()
    expect(result.evaluations).toHaveLength(1)
    expect(result.report?.overallFeedback).toBeTruthy()
    expect(result.status).toBe('finished')
    expect(result.state.phase).toBe('done')
    expect(() => session.appendSegment(segment('late'))).toThrow('ended')
  })
  it('discards a scorer response arriving after cancellation', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const session = await create({
      evaluate: async (answer: EvaluatorInput) => {
        await blocked
        return evaluateAnswer(answer, { stub: true })
      }
    })
    session.appendSegment(segment('I built the API.'))
    const pending = session.gap()
    session.cancel()
    await pending
    release()
    await Promise.resolve()
    expect(session.snapshot().evaluations).toHaveLength(0)
    expect(session.snapshot().conditioning).toHaveLength(2)
    expect(session.snapshot().status).toBe('cancelled')
  })
  it('bounds hung scorer and stops requests instead of overlapping timed-out calls', async () => {
    vi.useFakeTimers()
    try {
      const evaluator = vi.fn(() => new Promise<never>(() => {}))
      const session = await create({ evaluate: evaluator, roleTimeoutMs: 50 })
      session.appendSegment(segment('I built the API.'))
      const pending = session.gap()
      await vi.advanceTimersByTimeAsync(51)
      await pending
      await session.gap()
      expect(session.snapshot().status).toBe('failed')
      expect(session.snapshot().error).toContain('timed out')
      expect(evaluator).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('rejects invalid timestamps before storing transcript', async () => {
    const session = await create()
    expect(() => session.appendSegment({ ...segment('text'), startMs: Number.NaN })).toThrow(
      'timestamp'
    )
    expect(session.snapshot().transcript).toHaveLength(3)
  })
})
describe('same-answer rigor replay', () => {
  const context = {
    topicId: 'checkout',
    topicLabel: 'Checkout',
    question: 'What did you build?',
    level: 'mid' as const,
    turn: 1
  }
  it('compares cascade whole answer with gap scores without passing live gate with stubs', async () => {
    const result = await compareMoshiRigor(
      [
        {
          context,
          segments: [segment('I built a service.'), segment('Because checkout failed.', 300)]
        }
      ],
      { stub: true }
    )
    expect(result.mode).toBe('stub')
    expect(result.verdict).toBe('fixture-only')
    expect(result.rows[0].answer).toBe('I built a service. Because checkout failed.')
    expect(result.rows[0].gapEvaluations).toHaveLength(2)
    expect(Object.keys(result.rows[0].dimensions)).toHaveLength(5)
  })
  it('detects coverage loss when fragmented answers lose substantive depth', async () => {
    const text =
      'I designed a service because users needed faster checkout and chose a queue instead of synchronous writes after an outage. My team weighed alternatives and I owned the API implementation, deployment, monitoring, rollback plan, and production incident follow up with measured request latency.'
    const words = text.split(' ')
    const result = await compareMoshiRigor(
      [
        {
          context,
          segments: [segment(words.slice(0, 24).join(' ')), segment(words.slice(24).join(' '), 400)]
        }
      ],
      { stub: true }
    )
    expect(result.rows[0].dimensions.architecture.cascade).toBe('explored')
    expect(result.rows[0].dimensions.architecture.gap).toBe('partial')
    expect(result.agreement).toBeLessThan(1)
  })
})

it('starts scoring after an earlier empty gap in the same event turn', async () => {
  const session = await create()
  const empty = session.gap()
  session.appendSegment(segment('I built checkout.'))
  await Promise.all([empty, session.gap()])
  expect(session.snapshot().evaluations).toHaveLength(1)
})

it('routes report through configured model', async () => {
  const { summarizeInterview } = await import('./roles/summary')
  const provider = {
    parse: vi.fn(async (_request: import('./roles/parse').StructuredRequest) => ({
      stop_reason: 'end_turn',
      parsed_output: {
        overallFeedback: 'Grounded report',
        strengths: [],
        improvementAreas: [],
        starStories: []
      },
      usage: { input_tokens: 1, output_tokens: 1 }
    }))
  }
  await summarizeInterview(
    {
      transcript: [],
      roadmap: { topics: [], objectives: [] },
      candidate: { level: 'mid', confidence: 0, demonstratedSkill: 0 }
    },
    { provider, model: 'configured-summary-model', usageId: 'configured-usage', stub: false }
  )
  expect(provider.parse.mock.calls[0][0]).toMatchObject({ model: 'configured-summary-model' })
})

it('discards summary arriving after cancellation', async () => {
  let release!: (report: import('./roles').InterviewReport) => void
  const report = new Promise<import('./roles').InterviewReport>((resolve) => {
    release = resolve
  })
  const summarize = vi.fn(() => report)
  const session = await create({ summarize })
  session.appendSegment(segment('I built the service.'))
  await session.gap()
  const finishing = session.finish()
  await vi.waitFor(() => expect(summarize).toHaveBeenCalledOnce())
  session.cancel()
  release({ overallFeedback: 'late', strengths: [], improvementAreas: [], starStories: [] })
  await finishing
  expect(session.snapshot().report).toBeNull()
})

it('replays actual gap batches instead of treating every ASR segment as a separate answer', async () => {
  const { compareMoshiSessionRigor } = await import('./moshi-interview')
  const session = await create()
  session.appendSegment(segment('I built the API.'))
  session.appendSegment(segment('Because users needed checkout.', 300))
  await session.gap()
  const comparison = await compareMoshiSessionRigor(session.snapshot(), { stub: true })
  expect(comparison.rows[0].gapEvaluations).toHaveLength(1)
  expect(comparison.sourceSessionId).toBe(session.id)
  expect(comparison.sourceMode).toBe('stub')
})

it('keeps target job requirements outside resume evidence in architect input', async () => {
  const { buildRoadmap } = await import('./roles/architect')
  const parse = vi.fn(async (_request: import('./roles/parse').StructuredRequest) => ({
    stop_reason: 'end_turn',
    parsed_output: {
      topics: [
        { id: 'checkout', label: 'Checkout', value: 5, seed_coverage: [], open_threads: [] }
      ],
      objectives: []
    },
    usage: { input_tokens: 1, output_tokens: 1 }
  }))
  await buildRoadmap(
    { resumeText: 'I built checkout.', jobDescription: 'Must have Kubernetes experience.' },
    { provider: { parse }, stub: false }
  )
  expect(parse.mock.calls[0][0].userText).toContain('>>>RESUME')
  expect(parse.mock.calls[0][0].userText).toContain('<<<JOB_DESCRIPTION')
  expect(parse.mock.calls[0][0].userText).toContain('not evidence of candidate experience')
})

it('keeps cascade intro behavior without scoring introductory speech', async () => {
  const evaluate = vi.fn()
  const session = await createRaw({ evaluate })
  session.recordConditioningDelivery(1, 'consumed')
  session.appendSegment({ ...segment('Introduce yourself.', 0, 'interviewer'), endMs: 1 })
  session.appendSegment(segment('I work on checkout services.'))
  await session.gap()
  expect(evaluate).not.toHaveBeenCalled()
  expect(session.snapshot().evaluations).toEqual([])
  expect(session.snapshot().state.phase).toBe('exploration')
  expect(session.snapshot().transcript[1].text).toBe('I work on checkout services.')
})

it('combines interviewer segments into actual question context', async () => {
  const session = await create()
  session.appendSegment(segment('How did', 10, 'interviewer'))
  session.appendSegment(segment('you design checkout?', 110, 'interviewer'))
  session.appendSegment(segment('I built the API.', 250))
  await session.gap()
  expect(session.snapshot().evaluations[0].input.question).toBe(
    'Tell me about Checkout. How did you design checkout?'
  )
  expect(session.snapshot().models?.evaluator).toBeTruthy()
})

it('keeps cascade closing response unscored', async () => {
  let now = 0
  const evaluate = vi.fn((answer: EvaluatorInput) => evaluateAnswer(answer, { stub: true }))
  const session = await startMoshiInterview(
    { ...input, budgetMs: 100, closingReserveMs: 0 },
    runtime,
    { now: () => now, onConditioning: vi.fn(), save: vi.fn(), evaluate }
  )
  session.recordConditioningDelivery(1, 'consumed')
  session.appendSegment({ ...segment('Introduce yourself.', 0, 'interviewer'), endMs: 1 })
  session.appendSegment(segment('Introduction.'))
  await session.gap()
  session.recordConditioningDelivery(2, 'consumed')
  session.appendSegment({ ...segment('Tell me about Checkout.', 210, 'interviewer'), endMs: 220 })
  now = 100
  session.appendSegment(segment('I built checkout.', 300))
  await session.gap()
  expect(session.snapshot().conditioning.at(-1)?.action.intent.kind).toBe('closing')
  session.recordConditioningDelivery(3, 'consumed')
  session.appendSegment({ ...segment('Any final questions?', 410, 'interviewer'), endMs: 420 })
  session.appendSegment(segment('Thank you.', 500))
  await session.gap()
  expect(evaluate).toHaveBeenCalledOnce()
  expect(session.snapshot().state.phase).toBe('done')
  expect(session.snapshot().transcript).toHaveLength(6)
})
