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
  addCandidateTurn,
  sessionConfig,
  askedQuestions,
  currentQuestion,
  endSession
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

  addCandidateTurn(
    arg.sessionId,
    arg.answer,
    turn.feedback,
    { unbanked: turn.unbanked },
    turn.used_experience_ids
  )
  if (turn.next_kind === 'done') endSession(arg.sessionId)
  else if (turn.next_text) addInterviewerTurn(arg.sessionId, turn.next_text)

  const byId = new Map(candidates.map((c) => [c.id, c.title]))
  return {
    ...turn,
    used: turn.used_experience_ids.map((id) => ({ id, title: byId.get(id) ?? 'Untitled experience' }))
  }
}
