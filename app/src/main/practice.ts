import { z } from 'zod'
import {
  firstQuestion,
  evaluateAnswer,
  practiceConfig,
  type CandidateExperience,
  type InterviewTurn
} from './ai/interview'
import { listExperiences } from './db/repositories/experiences'
import {
  createSession,
  addInterviewerTurn,
  commitAnswer,
  isSessionOpen,
  sessionConfig,
  askedQuestions,
  currentQuestion
} from './db/repositories/practice'

const MAX_CANDIDATES = 40

export const answerArg = z.object({
  sessionId: z.string().min(1).max(64),
  answer: z.string().trim().min(1).max(20_000)
})

function bankCandidates(): CandidateExperience[] {
  return listExperiences({ status: 'confirmed' })
    .slice(0, MAX_CANDIDATES)
    .map((e) => ({ id: e.id, title: e.title }))
}

export interface StartResult {
  sessionId: string
  question: string
}

export async function startPractice(rawConfig: unknown): Promise<StartResult> {
  const config = practiceConfig.parse(rawConfig)
  const candidates = bankCandidates()
  const question = await firstQuestion(config, candidates)
  const sessionId = createSession(config)
  addInterviewerTurn(sessionId, question)
  return { sessionId, question }
}

export interface AnswerResult extends InterviewTurn {
  used: { id: string; title: string }[]
}

export async function answerPractice(arg: z.infer<typeof answerArg>): Promise<AnswerResult> {
  const config = sessionConfig(arg.sessionId)
  if (!config) throw new Error('practice session not found')
  if (!isSessionOpen(arg.sessionId)) throw new Error('this practice session has ended')
  const question = currentQuestion(arg.sessionId)
  if (!question) throw new Error('no question to answer yet')

  const candidates = bankCandidates()
  const turn = await evaluateAnswer({
    config,
    candidates,
    asked: askedQuestions(arg.sessionId),
    question,
    answer: arg.answer
  })

  // A missing next_text on a non-done move would strand the session with no live question,
  // so treat "done" and "no follow-up text" alike as the terminal move.
  const nextText = turn.next_text.trim()
  commitAnswer({
    sessionId: arg.sessionId,
    answer: arg.answer,
    feedback: turn.feedback,
    flags: { unbanked: turn.unbanked },
    experienceIds: turn.used_experience_ids,
    next: turn.next_kind !== 'done' && nextText ? { kind: 'ask', text: nextText } : { kind: 'done' }
  })

  const byId = new Map(candidates.map((c) => [c.id, c.title]))
  return {
    ...turn,
    used: turn.used_experience_ids.map((id) => ({ id, title: byId.get(id) ?? 'Untitled experience' }))
  }
}
