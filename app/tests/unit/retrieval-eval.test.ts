import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'
import { initDb, getDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { passageFor } from '../../src/main/embed/queue'
import { searchExperiences, type Embedder } from '../../src/main/search'
import { EVAL_BANK, EVAL_QUERIES } from '../fixtures/eval-bank'

// Real embeddings need the local model + (first run) network, so this is opt-in:
// run locally with STARFOLIO_RUN_EVAL=1 for the Stage 3 checkpoint; CI skips it to stay
// deterministic and offline. Hybrid retrieval's plumbing is covered by search.test.ts.
const run = process.env.STARFOLIO_RUN_EVAL === '1'

describe.skipIf(!run)('retrieval eval — themed queries surface the right experience top-3', () => {
  let embedText: Embedder

  beforeAll(async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(process.cwd(), '.cache', 'hf')
    env.allowRemoteModels = true
    const pipe = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'q8' })
    embedText = async (text) => {
      const out = await pipe(text, { pooling: 'mean', normalize: true })
      return Float32Array.from(out.data as Float32Array)
    }

    initDb(':memory:')
    const db = getDb()
    for (const e of EVAL_BANK) {
      const exp = createExperience({ ...e, status: 'confirmed' } as unknown)
      const vec = await embedText(passageFor(exp.id)!)
      db.prepare(
        'INSERT OR REPLACE INTO vec_experiences (experience_id, embedding) VALUES (?, ?)'
      ).run(exp.id, vec)
    }
  }, 300_000)

  it('lands every themed query target in the top 3', async () => {
    const misses: string[] = []
    for (const { query, expectTitle } of EVAL_QUERIES) {
      const results = await searchExperiences({ query }, embedText)
      const rank = results.findIndex((r) => r.title === expectTitle)
      if (rank < 0 || rank >= 3) misses.push(`"${query}" → ${rank < 0 ? 'not found' : `rank ${rank + 1}`}`)
    }
    expect(misses, `top-3 misses:\n${misses.join('\n')}`).toEqual([])
  }, 120_000)
})
