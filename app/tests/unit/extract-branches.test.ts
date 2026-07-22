import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { extractEntities, extractStar } from '../../src/main/ai/extract'
import type { StructuredProvider, StructuredResult } from '../../src/main/ai/roles/parse'

const goodOutput = {
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

function fakeProvider(msg: Partial<StructuredResult>): StructuredProvider {
  return {
    parse: async () => ({
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
      ...msg
    })
  }
}

describe('extract branch edges', () => {
  beforeEach(() => {
    initDb(':memory:')
    delete process.env.STARFOLIO_AI_STUB
  })
  afterEach(() => {
    delete process.env.STARFOLIO_AI_STUB
  })

  it('logs zero cache-read tokens when the model usage omits them', async () => {
    await extractStar('notes', fakeProvider({ parsed_output: goodOutput }))
    const rows = getDb()
      .prepare("SELECT cache_read_tokens FROM usage_log WHERE feature = 'extract'")
      .all()
    expect(rows).toEqual([{ cache_read_tokens: 0 }])
  })

  it('stub entity extraction caps at eight deduped tool names', async () => {
    process.env.STARFOLIO_AI_STUB = '1'
    const text = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Alpha'
    const out = await extractEntities(text)
    expect(out.entities).toHaveLength(8)
    expect(out.entities.every((e) => e.kind === 'tool')).toBe(true)
    expect(new Set(out.entities.map((e) => e.name)).size).toBe(8)
  })
})
