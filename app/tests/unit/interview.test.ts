import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  firstQuestion,
  evaluateAnswer,
  RUBRIC_DIMENSIONS,
  type CandidateExperience,
  type PracticeConfig
} from '../../src/main/ai/interview'
import type { StructuredProvider } from '../../src/main/ai/roles/parse'

const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 }
function providerReturning(msg: { stop_reason: string | null; parsed_output?: unknown }): StructuredProvider {
  return { parse: async () => ({ ...msg, usage }) }
}

const config: PracticeConfig = { kind: 'genre', promptText: 'Leadership' }
const candidates: CandidateExperience[] = [
  { id: 'exp-1', title: 'Deploy pipeline rewrite' },
  { id: 'exp-2', title: 'Mentored interns' }
]

const VAGUE = 'I helped out and it went fine.'
const STRONG =
  'When the deploy pipeline kept failing under load I took ownership, rewrote the retry logic and added caching, and cut build times from 20 minutes to 4, which unblocked the whole team for the release.'

describe('interviewer engine (stub)', () => {
  beforeAll(() => {
    process.env.STARFOLIO_AI_STUB = '1'
  })
  afterAll(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  it('opens with a themed first question', async () => {
    const q = await firstQuestion(config, candidates)
    expect(q.toLowerCase()).toContain('leadership')
  })

  it('scores all four rubric dimensions on every answer', async () => {
    const turn = await evaluateAnswer({ config, candidates, asked: ['Q1'], question: 'Q1', answer: STRONG })
    for (const d of RUBRIC_DIMENSIONS) {
      expect(turn.feedback[d].score).toBeGreaterThanOrEqual(1)
      expect(turn.feedback[d].score).toBeLessThanOrEqual(5)
      expect(turn.feedback[d].note.length).toBeGreaterThan(0)
    }
    expect(turn.feedback.summary.length).toBeGreaterThan(0)
  })

  it('drills down on a vague, unquantified answer', async () => {
    const turn = await evaluateAnswer({ config, candidates, asked: ['Q1'], question: 'Q1', answer: VAGUE })
    expect(turn.next_kind).toBe('drilldown')
    expect(turn.next_text.length).toBeGreaterThan(0)
    expect(turn.feedback.measurable_result.score).toBeLessThanOrEqual(2)
  })

  it('advances on a strong, quantified answer', async () => {
    const turn = await evaluateAnswer({ config, candidates, asked: ['Q1'], question: 'Q1', answer: STRONG })
    expect(turn.next_kind).toBe('question')
    expect(turn.feedback.measurable_result.score).toBeGreaterThanOrEqual(3)
  })

  it('links an answer to the banked experience it draws on', async () => {
    const turn = await evaluateAnswer({ config, candidates, asked: ['Q1'], question: 'Q1', answer: STRONG })
    expect(turn.used_experience_ids).toContain('exp-1')
    expect(turn.unbanked).toBe(false)
  })

  it('flags an answer with no matching banked experience as unbanked', async () => {
    const turn = await evaluateAnswer({
      config,
      candidates,
      asked: ['Q1'],
      question: 'Q1',
      answer:
        'I organized a charity bake sale and we raised 500 dollars for the shelter over one weekend of work.'
    })
    expect(turn.used_experience_ids).toHaveLength(0)
    expect(turn.unbanked).toBe(true)
  })
})

describe('interviewer engine (live parse path)', () => {
  beforeAll(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  const params = { config, candidates, asked: ['Q1'], question: 'Q1', answer: STRONG }
  const feedbackScore = { score: 4, note: 'ok' }
  const turnOutput = {
    feedback: {
      star_completeness: feedbackScore,
      specificity: feedbackScore,
      measurable_result: feedbackScore,
      length: feedbackScore,
      summary: 'good'
    },
    next_kind: 'question',
    next_text: 'next',
    used_experience_ids: ['exp-1', 'not-a-real-id'],
    unbanked: false
  }

  it('surfaces the interviewer copy when the model refuses', async () => {
    const provider = providerReturning({ stop_reason: 'refusal' })
    await expect(firstQuestion(config, candidates, provider)).rejects.toThrow(
      'The interviewer declined to respond'
    )
    await expect(evaluateAnswer(params, provider)).rejects.toThrow('The interviewer declined to respond')
  })

  it('surfaces the interviewer failure copy with the stop_reason when parsing yields nothing', async () => {
    const provider = providerReturning({ stop_reason: 'max_tokens', parsed_output: null })
    await expect(firstQuestion(config, candidates, provider)).rejects.toThrow(
      'Interview call failed (stop_reason: max_tokens)'
    )
  })

  it('returns the parsed question on the happy path', async () => {
    const provider = providerReturning({ stop_reason: 'end_turn', parsed_output: { question: 'Tell me about a time.' } })
    expect(await firstQuestion(config, candidates, provider)).toBe('Tell me about a time.')
  })

  it('parses a turn and filters used ids to the banked set', async () => {
    const provider = providerReturning({ stop_reason: 'end_turn', parsed_output: turnOutput })
    const turn = await evaluateAnswer(params, provider)
    expect(turn.used_experience_ids).toEqual(['exp-1'])
    expect(turn.feedback.summary).toBe('good')
  })
})
