import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import {
  createSession,
  getSession,
  getTechnicalSession
} from '../../src/main/db/repositories/practice'

function insertRawTurn(sessionId: string, feedbackJson: string, flagsJson: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO practice_turns (id, session_id, role, content, feedback_json, flags_json)
       VALUES (?, ?, 'candidate', 'answer', ?, ?)`
    )
    .run(randomUUID(), sessionId, feedbackJson, flagsJson)
}

beforeEach(() => initDb(':memory:'))

describe('practice repo parse fallbacks', () => {
  it('getSession yields null feedback and flags for malformed turn json', () => {
    const id = createSession({ promptText: 'x' }, 'behavioral')
    insertRawTurn(id, '{not json', '{not json')

    const candidate = getSession(id)!.turns.find((t) => t.role === 'candidate')!
    expect(candidate.feedback).toBeNull()
    expect(candidate.flags).toBeNull()
  })

  it('getTechnicalSession defaults config and nulls feedback for malformed json', () => {
    const id = randomUUID()
    getDb()
      .prepare(`INSERT INTO practice_sessions (id, mode, config_json) VALUES (?, 'technical', '{bad')`)
      .run(id)
    insertRawTurn(id, '{bad', null)

    const session = getTechnicalSession(id)!
    expect(session.config).toEqual({ promptText: 'technical practice' })
    expect(session.turns.find((t) => t.role === 'candidate')!.feedback).toBeNull()
  })
})
