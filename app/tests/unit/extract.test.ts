import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import { extractStar, starExtraction, AiRefusalError } from '../../src/main/ai/extract'
import type { StructuredProvider, StructuredResult } from '../../src/main/ai/roles/parse'

function fakeProvider(msg: Partial<StructuredResult>): StructuredProvider {
  return {
    parse: async () => ({
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
      ...msg
    })
  }
}

const goodOutput = {
  title: 'Led the pipeline rewrite',
  context: 'work',
  situation: { text: 'Deploys took forty minutes.', confidence: 'high' },
  task: { text: 'Cut the time down.', confidence: 'high' },
  action: { text: 'Rebuilt CI with caching.', confidence: 'high' },
  result: { text: 'Deploys dropped to eight minutes.', confidence: 'high' },
  skills: [{ name: 'CI/CD', kind: 'technical' }],
  tags: ['infra'],
  metrics: [{ label: 'deploy time', value: 8, unit: 'min' }],
  gaps: []
}

describe('extractStar (stub)', () => {
  beforeEach(() => {
    process.env.STARFOLIO_AI_STUB = '1'
  })
  afterEach(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  it('returns a schema-valid draft from pasted notes without a client', async () => {
    const out = await extractStar('Rewrote the deploy pipeline last quarter.')
    expect(() => starExtraction.parse(out)).not.toThrow()
    expect(out.title).toBe('Rewrote the deploy pipeline last quarter.')
    expect(out.gaps.length).toBeGreaterThan(0)
  })

  it('rejects empty input before touching a model', async () => {
    await expect(extractStar('   ')).rejects.toThrow(/Nothing to extract/)
  })
})

describe('extractStar (injected provider)', () => {
  beforeEach(() => {
    initDb(':memory:')
    delete process.env.STARFOLIO_AI_STUB
  })

  it('maps a validated model response and logs usage', async () => {
    const out = await extractStar('notes', fakeProvider({ parsed_output: goodOutput }))
    expect(out.title).toBe('Led the pipeline rewrite')
    expect(out.skills[0]).toEqual({ name: 'CI/CD', kind: 'technical' })
    const rows = getDb().prepare("SELECT feature, in_tokens FROM usage_log WHERE feature = 'extract'").all()
    expect(rows).toEqual([{ feature: 'extract', in_tokens: 10 }])
  })

  it('throws AiRefusalError on a refusal stop_reason', async () => {
    await expect(
      extractStar('notes', fakeProvider({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }))
    ).rejects.toBeInstanceOf(AiRefusalError)
  })

  it('throws when the model returns no parsed output', async () => {
    await expect(
      extractStar('notes', fakeProvider({ stop_reason: 'max_tokens', parsed_output: null }))
    ).rejects.toThrow(/Extraction failed/)
  })
})
