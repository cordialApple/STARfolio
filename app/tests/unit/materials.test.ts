import { describe, it, expect } from 'vitest'
import { markdownToDocx } from '../../src/main/export/docx'
import { extractBullets } from '../../src/main/ai/bullets'
import type { Experience } from '../../src/main/db/repositories/experiences'

function exp(id: string, title: string, extra: Partial<Experience> = {}): Experience {
  return {
    id,
    title,
    situation: '',
    task: '',
    action: 'did the work',
    result_text: '',
    context: 'work',
    happened_start: null,
    happened_end: null,
    status: 'confirmed',
    draft_state_json: null,
    created_at: '',
    updated_at: '',
    skills: [],
    tags: [],
    metrics: [],
    sources: [],
    ...extra
  } as Experience
}

function mockClient(output: unknown): { messages: { parse: () => Promise<unknown> } } {
  return {
    messages: {
      parse: async () => ({ stop_reason: null, parsed_output: output, usage: { input_tokens: 0, output_tokens: 0 } })
    }
  }
}

describe('markdownToDocx', () => {
  it('produces a valid docx whose text round-trips through a reader', async () => {
    const buf = markdownToDocx('# Jane Rivera\njane@example.com\n\n## Experience\n- Cut deploy time by 80%\n- Led a team of five')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ buffer: buf })
    expect(value).toContain('Jane Rivera')
    expect(value).toContain('Cut deploy time by 80%')
    expect(value).toContain('Led a team of five')
  })
})

describe('extractBullets grounding', () => {
  it('keeps only bullets that tag a real provided experience', async () => {
    const client = mockClient({
      bullets: [
        { text: 'Cut invoice generation from 6 hours to 20 minutes', experience_id: 'e1' },
        { text: 'A fabricated bullet', experience_id: 'ghost' },
        { text: '', experience_id: 'e1' }
      ]
    })
    const out = await extractBullets('a backend role', [exp('e1', 'Billing migration')], client as never)
    expect(out).toHaveLength(1)
    expect(out[0].experienceId).toBe('e1')
    expect(out[0].experienceTitle).toBe('Billing migration')
    // metric preserved verbatim
    expect(out[0].text).toContain('20 minutes')
  })

  it('returns nothing when there are no experiences to ground on', async () => {
    const out = await extractBullets('jd', [])
    expect(out).toEqual([])
  })

  it('stub drafts one bullet per experience tagged to it', async () => {
    const prev = process.env.STARFOLIO_AI_STUB
    process.env.STARFOLIO_AI_STUB = '1'
    try {
      const out = await extractBullets('jd', [exp('e1', 'Alpha'), exp('e2', 'Beta')])
      expect(out.map((b) => b.experienceId).sort()).toEqual(['e1', 'e2'])
    } finally {
      process.env.STARFOLIO_AI_STUB = prev
    }
  })
})
