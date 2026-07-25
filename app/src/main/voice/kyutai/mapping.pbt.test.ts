import { describe, it } from 'vitest'
import type { TranscriptEvent } from '../streaming/types'
import { runProperty } from '../pbt/pbt'
import { outSchedule, toWire } from '../pbt/events'
import { KyutaiSttAdapter } from './adapter'
import { FakeTransport } from './transport'
import { isEndOfTurn, type OutMsg } from './protocol'

function drive(schedule: OutMsg[]): TranscriptEvent[] {
  const events: TranscriptEvent[] = []
  const transport = new FakeTransport()
  new KyutaiSttAdapter({ transport, onTranscript: (e) => events.push(e), onError: () => {} })
  for (const msg of schedule) transport.deliver(toWire(msg))
  return events
}

function referenceReducer(schedule: OutMsg[]): string[] {
  const finals: string[] = []
  let words: string[] = []
  for (const m of schedule) {
    if (m.type === 'Word') words.push(m.text)
    else if (m.type === 'Step' && isEndOfTurn(m) && words.length > 0) {
      finals.push(words.join(' '))
      words = []
    }
  }
  return finals
}

// [in-memory, MODELLED wire, NO moshi-server — proves the stabilization reducer, not endpointing;
//  see docs/plans/pbt-in-ci.md §7 R3]
describe('TranscriptAssembler — transport-adversary spine (PBT)', () => {
  it('every emitted event has stableUpTo === text.length (all committed)', () => {
    runProperty('mapping/stableUpTo-eq-length', outSchedule, (schedule) => {
      for (const e of drive(schedule)) if (e.stableUpTo !== e.text.length) return false
      return true
    })
  })

  it('within a turn the prior text is a prefix of the next (never rewritten backward)', () => {
    runProperty('mapping/within-turn-prefix-monotone', outSchedule, (schedule) => {
      let prev = ''
      for (const e of drive(schedule)) {
        if (!e.text.startsWith(prev)) return false
        prev = e.isFinal ? '' : e.text
      }
      return true
    })
  })

  it('finals match an independent reference reducer over the delivered order', () => {
    runProperty('mapping/finals-match-reference', outSchedule, (schedule) => {
      const finals = drive(schedule).filter((e) => e.isFinal).map((e) => e.text)
      const ref = referenceReducer(schedule)
      if (finals.length !== ref.length) return false
      return finals.every((t, i) => t === ref[i])
    })
  })
})
