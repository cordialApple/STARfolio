import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import {
  extractResumeStar,
  extractEvidenceStar,
  extractEntities,
  starExtraction,
  entityExtraction,
  AiRefusalError,
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

describe('extractResumeStar (stub)', () => {
  beforeEach(() => {
    process.env.STARFOLIO_AI_STUB = '1'
  })
  afterEach(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  it('splits blank-line-separated blocks into one draft each', async () => {
    const out = await extractResumeStar('Built the billing service\n\nRan the on-call rotation')
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('Built the billing service')
    expect(out[1].title).toBe('Ran the on-call rotation')
    expect(() => out.forEach((e) => starExtraction.parse(e))).not.toThrow()
  })

  it('caps at five drafts', async () => {
    const text = Array.from({ length: 9 }, (_, i) => `Role ${i}`).join('\n\n')
    expect(await extractResumeStar(text)).toHaveLength(5)
  })

  it('rejects an empty document before touching a model', async () => {
    await expect(extractResumeStar('   ')).rejects.toThrow(/Nothing to extract/)
  })
})

describe('extractEvidenceStar (stub)', () => {
  beforeEach(() => {
    process.env.STARFOLIO_AI_STUB = '1'
  })
  afterEach(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  it('tags with the evidence kind and leaves impact beats thin with gaps', async () => {
    const out = await extractEvidenceStar('def main(): pass', 'code')
    expect(out.tags).toEqual(['code'])
    expect(out.context).toBe('project')
    expect(out.situation.text).toBe('')
    expect(out.result.text).toBe('')
    expect(out.gaps.map((g) => g.field)).toContain('result')
    expect(() => starExtraction.parse(out)).not.toThrow()
  })

  it('rejects empty evidence', async () => {
    await expect(extractEvidenceStar('  ', 'repo')).rejects.toThrow(/Nothing to extract/)
  })
})

describe('extractEntities (stub)', () => {
  beforeEach(() => {
    process.env.STARFOLIO_AI_STUB = '1'
  })
  afterEach(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  it('pulls capitalized tokens as tool entities, deduped and capped', async () => {
    const out = await extractEntities('Shipped Postgres and Redis using Postgres again')
    expect(out.entities.every((e) => e.kind === 'tool')).toBe(true)
    const names = out.entities.map((e) => e.name)
    expect(names).toContain('Postgres')
    expect(new Set(names).size).toBe(names.length)
    expect(() => entityExtraction.parse(out)).not.toThrow()
  })

  it('returns no entities for blank text without a model', async () => {
    expect(await extractEntities('   ')).toEqual({ entities: [] })
  })
})

describe('extract siblings (injected client)', () => {
  beforeEach(() => {
    initDb(':memory:')
    delete process.env.STARFOLIO_AI_STUB
  })

  it('validates a resume response and logs usage', async () => {
    const parsed_output = {
      experiences: [
        {
          title: 'Led the pipeline rewrite',
          context: 'work',
          situation: { text: 's', confidence: 'high' },
          task: { text: 't', confidence: 'high' },
          action: { text: 'a', confidence: 'high' },
          result: { text: 'r', confidence: 'high' },
          skills: [],
          tags: [],
          metrics: [],
          gaps: []
        }
      ]
    }
    const out = await extractResumeStar('resume', fakeClient({ parsed_output }))
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Led the pipeline rewrite')
    const rows = getDb()
      .prepare("SELECT feature FROM usage_log WHERE feature = 'extract'")
      .all()
    expect(rows).toEqual([{ feature: 'extract' }])
  })

  it('validates an entity response', async () => {
    const parsed_output = { entities: [{ kind: 'org', name: 'Acme' }] }
    const out = await extractEntities('notes', fakeClient({ parsed_output }))
    expect(out.entities).toEqual([{ kind: 'org', name: 'Acme' }])
  })

  it('throws AiRefusalError on an evidence refusal', async () => {
    await expect(
      extractEvidenceStar('data', 'spreadsheet', fakeClient({ stop_reason: 'refusal' }))
    ).rejects.toBeInstanceOf(AiRefusalError)
  })
})
