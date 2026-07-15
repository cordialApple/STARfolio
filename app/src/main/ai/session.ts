import { randomUUID } from 'crypto'
import {
  initState,
  reduce,
  selectAction,
  type AnswerEvaluation,
  type ExperienceLevel,
  type InterviewAction,
  type InterviewState,
  type Topic
} from './roadmap'
import {
  buildRoadmap,
  composeUtterance,
  evaluateAnswer,
  summarizeInterview,
  type ArchitectExperience,
  type ConversationInput,
  type InterviewReport,
  type TranscriptTurn
} from './roles'
import type { ParseClient } from './roles/parse'

export interface StartInterviewInput {
  resumeText: string
  experiences?: ArchitectExperience[]
  candidateName?: string
  level?: ExperienceLevel
  budgetMs?: number
  closingReserveMs?: number
}

export interface AnswerInterviewInput {
  sessionId: string
  answer: string
  elapsedMs?: number
}

export interface InterviewStep {
  sessionId: string
  utterance: string
  action: InterviewAction
  phase: InterviewState['phase']
  done: boolean
  report: InterviewReport | null
}

interface InterviewSession {
  id: string
  state: InterviewState
  lastAction: InterviewAction
  lastUtterance: string
  candidateName?: string
  startedAtMs: number
  transcript: TranscriptTurn[]
  report: InterviewReport | null
}

const sessions = new Map<string, InterviewSession>()

function requireSession(id: string): InterviewSession {
  const session = sessions.get(id)
  if (!session) throw new Error('interview session not found')
  return session
}

const EMPTY_EVALUATION: AnswerEvaluation = {
  topicId: null,
  coverageDeltas: {},
  candidateDelta: {},
  newThreads: [],
  resolvedThreadIds: []
}

function topicById(state: InterviewState, id: string | null): Topic | null {
  if (!id) return null
  return state.roadmap.topics.find((t) => t.id === id) ?? null
}

function callbackNote(state: InterviewState, topicId: string): string | undefined {
  const forTopic = state.threads.filter((t) => t.topicId === topicId)
  if (forTopic.length === 0) return undefined
  return forTopic.sort((a, b) => b.value - a.value)[0].note
}

function toConversationInput(state: InterviewState, action: InterviewAction, candidateName?: string): ConversationInput {
  const input: ConversationInput = { action, candidateName }
  if (action.kind === 'probe' || action.kind === 'transition') {
    input.topicLabel = topicById(state, action.topicId)?.label
  }
  if (action.kind === 'transition' && action.callback) {
    input.callbackNote = callbackNote(state, action.topicId)
  }
  return input
}

async function evaluationFor(
  session: InterviewSession,
  answer: string,
  client?: ParseClient
): Promise<AnswerEvaluation> {
  const action = session.lastAction
  if (action.kind !== 'probe' && action.kind !== 'transition') return EMPTY_EVALUATION
  const topic = topicById(session.state, action.topicId)
  return evaluateAnswer(
    {
      topicId: action.topicId,
      topicLabel: topic?.label ?? action.topicId,
      question: session.lastUtterance,
      answer,
      level: session.state.candidate.level,
      turn: session.state.turnCount
    },
    client
  )
}

function toStep(session: InterviewSession): InterviewStep {
  return {
    sessionId: session.id,
    utterance: session.lastUtterance,
    action: session.lastAction,
    phase: session.state.phase,
    done: session.state.phase === 'done',
    report: session.report
  }
}

export async function startInterview(input: StartInterviewInput, client?: ParseClient): Promise<InterviewStep> {
  const roadmap = await buildRoadmap({ resumeText: input.resumeText, experiences: input.experiences }, client)
  const state = reduce(
    initState(roadmap, {
      budgetMs: input.budgetMs,
      closingReserveMs: input.closingReserveMs,
      candidate: input.level ? { level: input.level } : undefined
    }),
    { type: 'start' }
  )
  const action = selectAction(state)
  const utterance = await composeUtterance(toConversationInput(state, action, input.candidateName), client)
  const session: InterviewSession = {
    id: randomUUID(),
    state,
    lastAction: action,
    lastUtterance: utterance,
    candidateName: input.candidateName,
    startedAtMs: Date.now(),
    transcript: [{ speaker: 'interviewer', text: utterance }],
    report: null
  }
  sessions.set(session.id, session)
  return toStep(session)
}

export async function answerInterview(input: AnswerInterviewInput, client?: ParseClient): Promise<InterviewStep> {
  const session = requireSession(input.sessionId)
  if (session.state.phase === 'done') throw new Error('this interview has ended')
  const answer = input.answer.trim()
  if (!answer) throw new Error('an answer is required')

  session.transcript.push({ speaker: 'candidate', text: answer })

  const elapsedMs = input.elapsedMs ?? Date.now() - session.startedAtMs
  const evaluation = await evaluationFor(session, answer, client)
  let state = reduce(session.state, { type: 'answer', elapsedMs, evaluation })

  const action = selectAction(state)
  // Emitting a closing action IS the single closing prompt — mark it asked so the
  // next turn advances to done instead of asking to close twice.
  if (action.kind === 'closing') state = { ...state, closingAsked: true }

  const utterance = await composeUtterance(toConversationInput(state, action, session.candidateName), client)

  session.state = state
  session.lastAction = action
  session.lastUtterance = utterance
  session.transcript.push({ speaker: 'interviewer', text: utterance })

  if (state.phase === 'done') {
    session.report = await summarizeInterview(
      { transcript: session.transcript, roadmap: state.roadmap, candidate: state.candidate },
      client
    )
  }
  return toStep(session)
}

export function getInterviewReport(sessionId: string): InterviewReport | null {
  return requireSession(sessionId).report
}
