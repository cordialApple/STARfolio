import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sql008 from '../migrations/008_interview_sessions.sql?raw'
import sql009 from '../migrations/009_moshi_interview_audit.sql?raw'
import { saveMoshiInterview, loadMoshiInterview } from './moshi-interview'
import { emptyCoverage, initState } from '../../ai/roadmap'
import type { MoshiInterviewSnapshot } from '../../ai/moshi-interview'
const store = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('../client', () => ({ getDb: () => store.db }))
beforeEach(() => {
  store.db = new Database(':memory:')
  store.db.pragma('foreign_keys = ON')
  store.db.exec(sql008)
  store.db.exec(sql009)
})
afterEach(() => {
  store.db.close()
})
it('persists canonical audit and only actual speech in existing interview history', () => {
  const state = initState({
    topics: [
      {
        id: 'checkout',
        label: 'Checkout',
        value: 5,
        coverage: emptyCoverage(),
        unresolvedQuestions: [],
        askedCount: 0
      }
    ],
    objectives: []
  })
  const snapshot: MoshiInterviewSnapshot = {
    id: 'test-session',
    candidateName: null,
    startedAtMs: 1,
    mode: 'stub',
    status: 'active',
    state,
    transcript: [],
    evaluations: [],
    conditioning: [
      {
        revision: 1,
        roadmap: state.roadmap,
        action: { intent: { kind: 'ask_intro' }, authority: 'command' },
        delivery: 'requested'
      }
    ],
    commandConformance: 'unverified',
    report: null
  }
  saveMoshiInterview(snapshot)
  expect(store.db.prepare('SELECT * FROM interview_turns').all()).toEqual([])
  snapshot.transcript.push({
    speaker: 'candidate',
    text: 'I built checkout.',
    startMs: 10,
    endMs: 200,
    truncated: true
  })
  saveMoshiInterview(snapshot)
  store.db.exec(
    'CREATE TABLE removed_turns (id TEXT); CREATE TRIGGER track_turn_deletes AFTER DELETE ON interview_turns BEGIN INSERT INTO removed_turns VALUES (old.id); END'
  )
  saveMoshiInterview(snapshot)
  expect(store.db.prepare('SELECT * FROM removed_turns').all()).toEqual([])
  expect(loadMoshiInterview(snapshot.id)).toEqual(snapshot)
  expect(store.db.prepare('SELECT speaker, text FROM interview_turns').all()).toEqual([
    { speaker: 'candidate', text: 'I built checkout.' }
  ])
  store.db.prepare('DELETE FROM interview_sessions WHERE id = ?').run(snapshot.id)
  expect(loadMoshiInterview(snapshot.id)).toBeNull()
})
