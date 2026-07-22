import { beforeEach, describe, expect, it } from 'vitest'
import { extractBullets } from '../../src/main/ai/bullets'
import type { StructuredProvider } from '../../src/main/ai/roles/parse'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'

beforeEach(() => initDb(':memory:'))

function capturingProvider(): { provider: StructuredProvider; userText: () => string } {
  let seen = ''
  const provider: StructuredProvider = {
    parse: async (req) => {
      seen = req.userText
      return {
        stop_reason: 'end_turn',
        parsed_output: { bullets: [] },
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    }
  }
  return { provider, userText: () => seen }
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
    const { provider, userText } = capturingProvider()
    await extractBullets('jd', [e], provider)
    expect(userText()).toContain('Metrics: latency: 120ms; incidents:')
  })
})
