import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractBullets, generateBullets } from '../../src/main/ai/bullets'
import type { ParseClient } from '../../src/main/ai/roles/parse'
import { initDb } from '../../src/main/db/client'
import { createExperience, type Experience } from '../../src/main/db/repositories/experiences'

beforeEach(() => {
  initDb(':memory:')
})
afterEach(() => vi.unstubAllEnvs())

function make(title: string): Experience {
  return createExperience({ title })
}

function fakeClient(bullets: { text: string; experience_id: string }[]): ParseClient {
  return {
    messages: {
      parse: async () => ({
        stop_reason: 'end_turn',
        parsed_output: { bullets },
        usage: { input_tokens: 1, output_tokens: 1 }
      })
    }
  }
}

describe('extractBullets stub path', () => {
  it('returns empty without touching the model when there are no experiences', async () => {
    expect(await extractBullets('jd', [])).toEqual([])
  })

  it('maps each experience title to a grounded bullet', async () => {
    vi.stubEnv('STARFOLIO_AI_STUB', '1')
    const e = make('Kafka migration')
    expect(await extractBullets('jd', [e])).toEqual([
      { text: 'Delivered Kafka migration', experienceId: e.id, experienceTitle: 'Kafka migration' }
    ])
  })

  it('caps the stub at 8 bullets', async () => {
    vi.stubEnv('STARFOLIO_AI_STUB', '1')
    const exps = Array.from({ length: 9 }, (_, i) => make(`role ${i}`))
    expect(await extractBullets('jd', exps)).toHaveLength(8)
  })

  it('falls back to Untitled and a generic bullet for a blank title', async () => {
    vi.stubEnv('STARFOLIO_AI_STUB', '1')
    const e = make('')
    expect(await extractBullets('jd', [e])).toEqual([
      { text: 'Delivered a key result', experienceId: e.id, experienceTitle: 'Untitled' }
    ])
  })
})

describe('extractBullets grounding', () => {
  it('drops bullets tagged with an unknown experience id', async () => {
    const e = make('real')
    const client = fakeClient([
      { text: 'keep me', experience_id: e.id },
      { text: 'drop me', experience_id: 'not-a-real-id' }
    ])
    const out = await extractBullets('jd', [e], client)
    expect(out).toEqual([{ text: 'keep me', experienceId: e.id, experienceTitle: 'real' }])
  })

  it('drops blank bullets and trims the surviving text', async () => {
    const e = make('real')
    const client = fakeClient([
      { text: '   ', experience_id: e.id },
      { text: '  trimmed  ', experience_id: e.id }
    ])
    const out = await extractBullets('jd', [e], client)
    expect(out).toEqual([{ text: 'trimmed', experienceId: e.id, experienceTitle: 'real' }])
  })
})

describe('generateBullets', () => {
  it('resolves ids and skips ones that no longer exist', async () => {
    vi.stubEnv('STARFOLIO_AI_STUB', '1')
    const e = make('shipped it')
    const out = await generateBullets('jd', [e.id, 'missing-id'])
    expect(out).toEqual([
      { text: 'Delivered shipped it', experienceId: e.id, experienceTitle: 'shipped it' }
    ])
  })
})
