import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import {
  findSourceByHash,
  insertSource,
  linkSource,
  sha256
} from '../../src/main/db/repositories/sources'
import { createExperience } from '../../src/main/db/repositories/experiences'

beforeEach(() => initDb(':memory:'))

const linkCount = (experienceId: string, sourceId: string): number =>
  (
    getDb()
      .prepare(
        'SELECT COUNT(*) c FROM experience_sources WHERE experience_id = ? AND source_id = ?'
      )
      .get(experienceId, sourceId) as { c: number }
  ).c

describe('sha256', () => {
  it('matches the known digest for "abc"', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('insertSource', () => {
  it('auto-hashes raw_text when no content_hash is given', () => {
    const id = insertSource(getDb(), { kind: 'paste', raw_text: 'hello world' })
    expect(findSourceByHash(sha256('hello world'))?.id).toBe(id)
  })

  it('respects an explicit content_hash over the auto hash', () => {
    const id = insertSource(getDb(), { kind: 'paste', raw_text: 'hello world', content_hash: 'pinned' })
    expect(findSourceByHash('pinned')?.id).toBe(id)
    expect(findSourceByHash(sha256('hello world'))).toBeNull()
  })
})

describe('linkSource', () => {
  it('links a source to an experience and ignores a duplicate link', () => {
    const exp = createExperience({ title: 'A', action: 'a' })
    const srcId = insertSource(getDb(), { kind: 'paste', raw_text: 'notes' })

    linkSource(getDb(), exp.id, srcId)
    linkSource(getDb(), exp.id, srcId)

    expect(linkCount(exp.id, srcId)).toBe(1)
  })
})
