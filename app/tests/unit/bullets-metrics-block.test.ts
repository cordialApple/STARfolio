import { beforeEach, describe, expect, it } from 'vitest'
import { extractBullets } from '../../src/main/ai/bullets'
import type { InterviewClient } from '../../src/main/ai/interview'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'

beforeEach(() => initDb(':memory:'))

function capturingClient(): { client: InterviewClient; userText: () => string } {
  let seen = ''
  const client: InterviewClient = {
    messages: {
      parse: async (params: unknown) => {
        seen = (params as { messages: { content: string }[] }).messages[0].content
        return {
          stop_reason: 'end_turn',
          parsed_output: { bullets: [] },
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      }
    }
  }
  return { client, userText: () => seen }
}

describe('extractBullets experience block metrics', () => {
  it('renders a metric line, tolerating a missing value and unit', async () => {
    const e = createExperience({
      title: 'Scaled infra',
      metrics: [
        { label: 'latency', value: 120, unit: 'ms' },
        { label: 'incidents' }
      ]
    })
    const { client, userText } = capturingClient()
    await extractBullets('jd', [e], client)
    expect(userText()).toContain('Metrics: latency: 120ms; incidents:')
  })
})
