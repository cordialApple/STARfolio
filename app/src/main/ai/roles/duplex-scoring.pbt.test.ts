import { describe, it, expect } from 'vitest'
import { runProperty } from '../../voice/pbt/pbt'
import { COVERAGE_STATUSES } from '../roadmap'
import { scoreAnswerDeterministic } from './evaluator'
import { candidateAnswer, evaluatorInputFrom, type AnswerContext } from './scorer-input'
import { cleanCandidateTranscript, duplexCaseArb, INTERVIEWER_TOKEN } from './pbt/scorer-input.arb'

const CTX: AnswerContext = {
  topicId: 'topic-1',
  topicLabel: 'The project',
  question: 'Walk me through it.',
  level: 'entry',
  turn: 1
}

const jsonEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

describe('Sonnet survives duplex (6d.2d)', () => {
  it('candidate answer never leaks interviewer speech (no barge-in bleed)', () => {
    runProperty('no-cross-speaker-bleed', duplexCaseArb, ({ transcript }) => {
      const tokens = candidateAnswer(transcript).text.split(/\s+/).filter(Boolean)
      return tokens.every((t) => !INTERVIEWER_TOKEN.test(t))
    })
  })

  it('scored answer depends only on candidate words, not on overlap/segmentation/truncation', () => {
    runProperty('duplex-invariance', duplexCaseArb, ({ transcript, candidateWords }) => {
      const clean = cleanCandidateTranscript(candidateWords.map((w) => [w]))
      const expected = candidateWords.join(' ')
      if (candidateAnswer(transcript).text !== expected) return false
      if (candidateAnswer(clean).text !== expected) return false
      const duplexScore = scoreAnswerDeterministic(evaluatorInputFrom(transcript, CTX))
      const cleanScore = scoreAnswerDeterministic(evaluatorInputFrom(clean, CTX))
      return jsonEq(duplexScore, cleanScore)
    })
  })

  it('truncation is preserved so the scorer can calibrate', () => {
    runProperty('truncation-visible', duplexCaseArb, ({ transcript, truncatedAny }) => {
      return candidateAnswer(transcript).truncated === truncatedAny
    })
  })

  it('scoring is total and in-range on any duplex-shaped input', () => {
    runProperty('rigor-totality', duplexCaseArb, ({ transcript }) => {
      const evalOut = scoreAnswerDeterministic(evaluatorInputFrom(transcript, CTX))
      const { demonstratedSkill, confidence } = evalOut.candidateDelta
      const skillOk = demonstratedSkill! >= 0 && demonstratedSkill! <= 1
      const confOk = confidence! >= 0 && confidence! <= 1
      const coverageOk = Object.values(evalOut.coverageDeltas).every((s) => COVERAGE_STATUSES.includes(s!))
      return skillOk && confOk && coverageOk
    })
  })

  it('scoring is deterministic — same duplex input scores identically twice', () => {
    runProperty('rigor-deterministic', duplexCaseArb, ({ transcript }) => {
      const input = evaluatorInputFrom(transcript, CTX)
      return jsonEq(scoreAnswerDeterministic(input), scoreAnswerDeterministic(input))
    })
  })

  it('rejects an empty candidate answer', () => {
    expect(() => scoreAnswerDeterministic({ ...CTX, answer: '   ' })).toThrow(/answer is required/)
  })
})
