import type { CanonicalTranscript } from '../transcript'
import type { ExperienceLevel } from '../roadmap'
import type { EvaluatorInput } from './evaluator'

export interface ScorableAnswer {
  text: string
  truncated: boolean
  segments: number
}

export interface AnswerContext {
  topicId: string
  topicLabel: string
  question: string
  level: ExperienceLevel
  turn: number
}

export function candidateAnswer(transcript: CanonicalTranscript): ScorableAnswer {
  const entries = transcript.all().filter((e) => e.speaker === 'candidate')
  const parts = entries.map((e) => e.text).filter(Boolean)
  return {
    text: parts.join(' '),
    truncated: entries.some((e) => e.truncated),
    segments: entries.length
  }
}

export function evaluatorInputFrom(transcript: CanonicalTranscript, ctx: AnswerContext): EvaluatorInput {
  return { ...ctx, answer: candidateAnswer(transcript).text }
}
