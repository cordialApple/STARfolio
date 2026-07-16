import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import {
  extractEvidenceStar,
  extractStar,
  type ExtractClient,
  type ExtractMessage
} from '../../src/main/ai/extract'

function fakeClient(msg: Partial<ExtractMessage>): ExtractClient {
  return {
    messages: {
      parse: async () => ({
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
        ...msg
      })
    }
  }
}

const evidenceOutput = {
  title: 'Built the ingest service',
  context: 'project',
  situation: { text: '', confidence: 'low' },
  task: { text: '', confidence: 'low' },
  action: { text: 'TypeScript worker with a queue.', confidence: 'high' },
  result: { text: '', confidence: 'low' },
  skills: [{ name: 'TypeScript', kind: 'technical' }],
  tags: ['repo'],
  metrics: [],
  gaps: [{ field: 'result', question: 'What was the outcome?' }]
}

describe('extractEvidenceStar and getExtractClient', () => {
  beforeEach(() => {
    initDb(':memory:')
    delete process.env.STARFOLIO_AI_STUB
  })
  afterEach(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  it('validates an injected evidence extraction response', async () => {
    const out = await extractEvidenceStar('a=1,b=2 rows', 'spreadsheet', fakeClient({ parsed_output: evidenceOutput }))
    expect(out.title).toBe('Built the ingest service')
    expect(out.tags).toEqual(['repo'])
  })

  it('throws when no api key is configured and no client is injected', async () => {
    await expect(extractStar('some notes')).rejects.toThrow('No Anthropic API key configured')
  })
})
