import { describe, expect, it } from 'vitest'
import { runProperty } from '../../voice/pbt/pbt'
import { authorityOf, directAction, selectAction } from './policy'
import { AUTHORITIES, type InterviewAction } from './types'
import { interviewStateArb } from './pbt/arbitraries'

const COMMAND_KINDS: InterviewAction['kind'][] = ['ask_intro', 'transition', 'closing', 'done']
const STEER_KINDS: InterviewAction['kind'][] = ['probe']

describe('authority seam (6d.2a)', () => {
  it('partitions every intent kind into exactly command or steer', () => {
    const kinds: InterviewAction['kind'][] = [...COMMAND_KINDS, ...STEER_KINDS]
    for (const kind of kinds) {
      const authority = authorityOf({ kind } as InterviewAction)
      expect(AUTHORITIES).toContain(authority)
      expect(authority).toBe(COMMAND_KINDS.includes(kind) ? 'command' : 'steer')
    }
  })

  it('directAction never throws and tags a valid authority for any state', () => {
    runProperty('authority/totality', interviewStateArb, (state) => {
      const directed = directAction(state)
      return AUTHORITIES.includes(directed.authority)
    })
  })

  it('directed intent is the selected intent verbatim — the wrapper never rephrases', () => {
    runProperty('authority/intent-identity', interviewStateArb, (state) => {
      const directed = directAction(state)
      return JSON.stringify(directed.intent) === JSON.stringify(selectAction(state))
    })
  })

  it('authority is a pure function of intent kind — same kind, same authority', () => {
    runProperty('authority/kind-pure', interviewStateArb, (state) => {
      const directed = directAction(state)
      return directed.authority === authorityOf({ kind: directed.intent.kind } as InterviewAction)
    })
  })

  it('probes steer, structural moves command', () => {
    runProperty('authority/probe-steers', interviewStateArb, (state) => {
      const { intent, authority } = directAction(state)
      return intent.kind === 'probe' ? authority === 'steer' : authority === 'command'
    })
  })
})
