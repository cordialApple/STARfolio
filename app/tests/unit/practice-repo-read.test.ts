import { describe, it, expect, beforeEach } from 'vitest'
import { initDb } from '../../src/main/db/client'
import {
  addInterviewerTurn,
  listAskedQuestions,
  commitAnswer,
  createSession,
  getCurrentQuestion,
  endSession,
  isSessionOpen,
  getRawSessionConfig,
  getSessionConfig,
  getSessionMode
} from '../../src/main/db/repositories/practice'

describe('practice repo read helpers', () => {
  beforeEach(() => initDb(':memory:'))

  it('reports session mode and null for unknown ids', () => {
    const behavioral = createSession({ kind: 'genre', promptText: 'Leadership' })
    const technical = createSession({ promptText: 'System design' }, 'technical')
    expect(getSessionMode(behavioral)).toBe('behavioral')
    expect(getSessionMode(technical)).toBe('technical')
    expect(getSessionMode('nope')).toBeNull()
  })

  it('parses stored config and falls back when it fails the schema', () => {
    const ok = createSession({ kind: 'jd', promptText: 'Backend role' })
    expect(getSessionConfig(ok)).toEqual({ kind: 'jd', promptText: 'Backend role' })

    const bad = createSession({ kind: 'genre' })
    expect(getSessionConfig(bad)).toEqual({ kind: 'genre', promptText: 'practice' })

    expect(getSessionConfig('nope')).toBeNull()
  })

  it('returns the raw config json verbatim', () => {
    const config = { kind: 'genre', promptText: 'Leadership' }
    const id = createSession(config)
    expect(getRawSessionConfig(id)).toBe(JSON.stringify(config))
    expect(getRawSessionConfig('nope')).toBeNull()
  })

  it('lists asked questions in order and tracks the current one', () => {
    const id = createSession({ kind: 'genre', promptText: 'x' })
    expect(listAskedQuestions(id)).toEqual([])
    expect(getCurrentQuestion(id)).toBeNull()

    addInterviewerTurn(id, 'Q1')
    commitAnswer({
      sessionId: id,
      answer: 'A1',
      feedback: {},
      flags: {},
      experienceIds: [],
      next: { kind: 'ask', text: 'Q2' }
    })

    expect(listAskedQuestions(id)).toEqual(['Q1', 'Q2'])
    expect(getCurrentQuestion(id)).toBe('Q2')
  })

  it('tracks open state and closes idempotently', () => {
    const id = createSession({ kind: 'genre', promptText: 'x' })
    const other = createSession({ kind: 'genre', promptText: 'y' })
    expect(isSessionOpen(id)).toBe(true)
    expect(isSessionOpen('nope')).toBe(false)

    endSession(id)
    expect(isSessionOpen(id)).toBe(false)
    expect(isSessionOpen(other)).toBe(true)

    endSession(id)
    expect(isSessionOpen(id)).toBe(false)
  })
})
