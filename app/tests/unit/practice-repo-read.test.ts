import { describe, it, expect, beforeEach } from 'vitest'
import { initDb } from '../../src/main/db/client'
import {
  addInterviewerTurn,
  askedQuestions,
  commitAnswer,
  createSession,
  currentQuestion,
  endSession,
  isSessionOpen,
  rawSessionConfig,
  sessionConfig,
  sessionMode
} from '../../src/main/db/repositories/practice'

describe('practice repo read helpers', () => {
  beforeEach(() => initDb(':memory:'))

  it('reports session mode and null for unknown ids', () => {
    const behavioral = createSession({ kind: 'genre', promptText: 'Leadership' })
    const technical = createSession({ promptText: 'System design' }, 'technical')
    expect(sessionMode(behavioral)).toBe('behavioral')
    expect(sessionMode(technical)).toBe('technical')
    expect(sessionMode('nope')).toBeNull()
  })

  it('parses stored config and falls back when it fails the schema', () => {
    const ok = createSession({ kind: 'jd', promptText: 'Backend role' })
    expect(sessionConfig(ok)).toEqual({ kind: 'jd', promptText: 'Backend role' })

    const bad = createSession({ kind: 'genre' })
    expect(sessionConfig(bad)).toEqual({ kind: 'genre', promptText: 'practice' })

    expect(sessionConfig('nope')).toBeNull()
  })

  it('returns the raw config json verbatim', () => {
    const config = { kind: 'genre', promptText: 'Leadership' }
    const id = createSession(config)
    expect(rawSessionConfig(id)).toBe(JSON.stringify(config))
    expect(rawSessionConfig('nope')).toBeNull()
  })

  it('lists asked questions in order and tracks the current one', () => {
    const id = createSession({ kind: 'genre', promptText: 'x' })
    expect(askedQuestions(id)).toEqual([])
    expect(currentQuestion(id)).toBeNull()

    addInterviewerTurn(id, 'Q1')
    commitAnswer({
      sessionId: id,
      answer: 'A1',
      feedback: {},
      flags: {},
      experienceIds: [],
      next: { kind: 'ask', text: 'Q2' }
    })

    expect(askedQuestions(id)).toEqual(['Q1', 'Q2'])
    expect(currentQuestion(id)).toBe('Q2')
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
