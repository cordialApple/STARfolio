import { expect, it, vi } from 'vitest'
import { emptyCoverage } from '../roadmap'
import { summarizeInterview } from './summary'

vi.mock('../../settings/secrets', () => ({ getSecret: vi.fn() }))
vi.mock('../usage', () => ({ logUsage: vi.fn() }))

it('reports role requirements only against observed interview evidence', async () => {
  const parse = vi.fn(async (_request: import('./parse').StructuredRequest) => ({
    stop_reason: 'end_turn',
    parsed_output: {
      overallFeedback: 'Candidate explained checkout design.',
      strengths: [],
      improvementAreas: [],
      starStories: []
    },
    usage: { input_tokens: 1, output_tokens: 1 }
  }))
  await summarizeInterview(
    {
      transcript: [
        { speaker: 'interviewer', text: 'What did you build?' },
        { speaker: 'candidate', text: 'I built the checkout API.' }
      ],
      roadmap: {
        objectives: [],
        topics: [
          {
            id: 'checkout',
            label: 'Checkout',
            value: 5,
            candidateEvidence: 'built the checkout API',
            roleRequirements: ['Kubernetes operations'],
            coverage: emptyCoverage(),
            unresolvedQuestions: [],
            askedCount: 1
          }
        ]
      },
      candidate: { level: 'entry', demonstratedSkill: 0.5, confidence: 0.5 }
    },
    { provider: { parse }, stub: false }
  )
  expect(parse.mock.calls[0][0].userText).toContain('resume claim: built the checkout API')
  expect(parse.mock.calls[0][0].userText).toContain('Kubernetes operations')
  expect(parse.mock.calls[0][0].system).toContain('Resume anchors are claims')
  expect(parse.mock.calls[0][0].system).toContain('Unasked role requirements are unassessed')
})
