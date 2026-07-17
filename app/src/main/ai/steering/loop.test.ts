import { describe, expect, it } from 'vitest'
import { SteeringLoop } from './loop'
import type { AnswerEvaluation } from '../roadmap'

const evalWith = (skill: number): AnswerEvaluation => ({
  topicId: null,
  coverageDeltas: {},
  candidateDelta: { demonstratedSkill: skill },
  newThreads: [],
  resolvedThreadIds: []
})

type DeferredCall = { text: string; resolve: (e: AnswerEvaluation) => void }

function deferredEvaluator(): {
  calls: DeferredCall[]
  evaluate: (text: string) => Promise<AnswerEvaluation>
} {
  const calls: DeferredCall[] = []
  const evaluate = (text: string): Promise<AnswerEvaluation> =>
    new Promise((resolve) => calls.push({ text, resolve }))
  return { calls, evaluate }
}

describe('SteeringLoop', () => {
  it('starts with no signal', () => {
    const loop = new SteeringLoop({ view: () => ({ text: '' }), evaluate: async () => evalWith(0) })
    expect(loop.latest()).toBeNull()
  })

  it('does not evaluate an empty view', async () => {
    const { calls, evaluate } = deferredEvaluator()
    const loop = new SteeringLoop({ view: () => ({ text: '   ' }), evaluate })
    expect(await loop.run(1)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('commits a signal from the evaluated view text', async () => {
    const { calls, evaluate } = deferredEvaluator()
    const loop = new SteeringLoop({ view: () => ({ text: 'live answer' }), evaluate })
    const p = loop.run(42)
    calls[0].resolve(evalWith(0.7))
    const signal = await p
    expect(signal).toEqual({
      at: 42,
      text: 'live answer',
      evaluation: evalWith(0.7)
    })
    expect(loop.latest()).toEqual(signal)
  })

  it('debounces: unchanged text does not re-evaluate', async () => {
    const { calls, evaluate } = deferredEvaluator()
    const loop = new SteeringLoop({ view: () => ({ text: 'same' }), evaluate })
    const p = loop.run(1)
    calls[0].resolve(evalWith(0.5))
    await p
    await loop.run(2)
    expect(calls).toHaveLength(1)
  })

  it('debounces an in-flight run on unchanged text without a second call', async () => {
    const { calls, evaluate } = deferredEvaluator()
    const loop = new SteeringLoop({ view: () => ({ text: 'same' }), evaluate })
    void loop.run(1)
    await loop.run(2)
    expect(calls).toHaveLength(1)
  })

  it('re-evaluates when the view text advances', async () => {
    const { calls, evaluate } = deferredEvaluator()
    let text = 'a'
    const loop = new SteeringLoop({ view: () => ({ text }), evaluate })
    const p1 = loop.run(1)
    calls[0].resolve(evalWith(0.1))
    await p1
    text = 'a b'
    const p2 = loop.run(2)
    calls[1].resolve(evalWith(0.9))
    await p2
    expect(loop.latest()?.evaluation.candidateDelta.demonstratedSkill).toBe(0.9)
    expect(loop.latest()?.at).toBe(2)
  })

  it('a stale older evaluation does not clobber a newer committed signal', async () => {
    const { calls, evaluate } = deferredEvaluator()
    let text = 'a'
    const loop = new SteeringLoop({ view: () => ({ text }), evaluate })
    const p1 = loop.run(1)
    text = 'a b'
    const p2 = loop.run(2)
    calls[1].resolve(evalWith(0.9))
    await p2
    calls[0].resolve(evalWith(0.1))
    await p1
    expect(loop.latest()?.evaluation.candidateDelta.demonstratedSkill).toBe(0.9)
  })

  it('reset clears the signal and lets the same text evaluate again', async () => {
    const { calls, evaluate } = deferredEvaluator()
    const loop = new SteeringLoop({ view: () => ({ text: 'again' }), evaluate })
    const p = loop.run(1)
    calls[0].resolve(evalWith(0.4))
    await p
    loop.reset()
    expect(loop.latest()).toBeNull()
    const p2 = loop.run(2)
    calls[1].resolve(evalWith(0.6))
    await p2
    expect(calls).toHaveLength(2)
    expect(loop.latest()?.evaluation.candidateDelta.demonstratedSkill).toBe(0.6)
  })
})
