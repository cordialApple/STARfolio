import fc from 'fast-check'
import { CanonicalTranscript } from '../../transcript'

const CANDIDATE_WORDS = [
  'because',
  'i',
  'designed',
  'the',
  'system',
  'chose',
  'instead',
  'failed',
  'owned',
  'built',
  'api',
  'tradeoff'
]

const INTERVIEWER_TOKEN = /^IV_/

const candidateWordArb = fc.constantFrom(...CANDIDATE_WORDS)
const interviewerWordArb = fc.integer({ min: 0, max: 999 }).map((n) => `IV_${n}`)

const candidateSegArb = fc.record({
  words: fc.array(candidateWordArb, { minLength: 1, maxLength: 6 }),
  truncated: fc.boolean()
})

const interviewerSegArb = fc.record({
  words: fc.array(interviewerWordArb, { minLength: 1, maxLength: 4 }),
  startMs: fc.integer({ min: 0, max: 12000 }),
  span: fc.integer({ min: 0, max: 2000 })
})

function appendCandidateSegments(
  transcript: CanonicalTranscript,
  segments: Array<{ words: string[]; truncated?: boolean }>
): void {
  segments.forEach((seg, k) => {
    transcript.append({
      speaker: 'candidate',
      text: seg.words.join(' '),
      startMs: k * 1000,
      endMs: k * 1000 + 500,
      truncated: seg.truncated
    })
  })
}

export interface DuplexCase {
  transcript: CanonicalTranscript
  candidateWords: string[]
  truncatedAny: boolean
}

export const duplexCaseArb: fc.Arbitrary<DuplexCase> = fc
  .record({
    candidate: fc.array(candidateSegArb, { minLength: 1, maxLength: 5 }),
    interviewer: fc.array(interviewerSegArb, { maxLength: 5 })
  })
  .map(({ candidate, interviewer }) => {
    const transcript = new CanonicalTranscript()
    appendCandidateSegments(transcript, candidate)
    for (const seg of interviewer) {
      transcript.append({
        speaker: 'interviewer',
        text: seg.words.join(' '),
        startMs: seg.startMs,
        endMs: seg.startMs + seg.span
      })
    }
    return {
      transcript,
      candidateWords: candidate.flatMap((s) => s.words),
      truncatedAny: candidate.some((s) => s.truncated)
    }
  })

export function cleanCandidateTranscript(words: string[][]): CanonicalTranscript {
  const transcript = new CanonicalTranscript()
  appendCandidateSegments(
    transcript,
    words.map((phrase) => ({ words: phrase }))
  )
  return transcript
}

export { fc, INTERVIEWER_TOKEN }
