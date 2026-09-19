import { expect, it, vi } from 'vitest'
import { verifyMoshiRealization } from './moshi-realization'
import type { StructuredRequest } from '../roles/parse'
vi.mock('../../settings/secrets', () => ({ getSecret: vi.fn() }))
vi.mock('../usage', () => ({ logUsage: vi.fn() }))
const requested = {
  action: { kind: 'transition' as const, topicId: 'beta', callback: false, reason: 'move' },
  topicLabel: 'Beta'
}
const previous = {
  action: {
    kind: 'probe' as const,
    topicId: 'alpha',
    dimension: 'architecture' as const,
    reason: 'depth'
  },
  topicLabel: 'Alpha'
}
it('binds observed prior topic instead of requested target in fixture mode', async () => {
  const result = await verifyMoshiRealization(
    {
      requested,
      previous,
      entries: [
        {
          speaker: 'interviewer',
          text: 'Tell me more about Alpha.',
          startMs: 1,
          endMs: 2,
          truncated: false
        }
      ]
    },
    { stub: true }
  )
  expect(result.binding).toBe('previous')
  expect(result.reason).toContain('fixture')
})
it('accepts identifying interrupted prefix without inventing missing words', async () => {
  const result = await verifyMoshiRealization(
    {
      requested,
      previous,
      entries: [
        { speaker: 'interviewer', text: 'What about Beta?', startMs: 1, endMs: 2, truncated: true }
      ]
    },
    { stub: true }
  )
  expect(result.binding).toBe('requested')
  expect(result.evidence).toBe('What about Beta?')
})
it('rejects an ungrounded structured verifier claim', async () => {
  const parse = vi.fn(async (_request: StructuredRequest) => ({
    stop_reason: 'end_turn',
    parsed_output: { binding: 'requested', evidence: 'Question never spoken', reason: 'guessed' },
    usage: { input_tokens: 1, output_tokens: 1 }
  }))
  const result = await verifyMoshiRealization(
    {
      requested,
      previous,
      entries: [
        { speaker: 'interviewer', text: 'Tell me more.', startMs: 1, endMs: 2, truncated: false }
      ]
    },
    { provider: { parse }, model: 'configured-evaluator', stub: false }
  )
  expect(result.binding).toBe('unknown')
  expect(parse.mock.calls[0][0].model).toBe('configured-evaluator')
})
