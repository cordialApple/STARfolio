import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import {
  addInterviewerTurn,
  commitAnswer,
  createSession,
  getSession,
  getTechnicalSession
} from '../../src/main/db/repositories/practice'

beforeEach(() => initDb(':memory:'))

function rawSession(mode: 'behavioral' | 'technical'): string {
  const id = randomUUID()
  getDb().prepare('INSERT INTO practice_sessions (id, mode, config_json) VALUES (?, ?, NULL)').run(id, mode)
  return id
}

function linkCount(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c
}

describe('practice repo branch gaps', () => {
  it('falls back to default behavioral config when config_json is null', () => {
    const id = rawSession('behavioral')
    expect(getSession(id)!.config).toEqual({ kind: 'genre', promptText: 'practice' })
  })

  it('falls back to default technical config when config_json is null', () => {
    const id = rawSession('technical')
    expect(getTechnicalSession(id)!.config).toEqual({ promptText: 'technical practice' })
  })

  it('skips corpus chunk links for chunk ids that do not exist', () => {
    const id = createSession({ promptText: 'x' }, 'behavioral')
    addInterviewerTurn(id, 'question', ['ghost-chunk'])
    expect(linkCount('practice_turn_corpus_chunks')).toBe(0)
  })

  it('skips experience links for experience ids that do not exist', () => {
    const id = createSession({ promptText: 'x' }, 'behavioral')
    commitAnswer({
      sessionId: id,
      answer: 'answer',
      feedback: {},
      flags: {},
      experienceIds: ['ghost-exp'],
      next: { kind: 'done' }
    })
    expect(linkCount('practice_turn_experiences')).toBe(0)
  })
})
