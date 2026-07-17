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
  composeUtteranceStream,
  evaluateAnswer,
  summarizeInterview,
  type ArchitectExperience,
  type ConversationInput,
  type EvaluatorInput,
  type InterviewReport,
  type TranscriptTurn
} from './roles'
import type { ParseClient } from './roles/parse'
import { resolveTransport } from './resolve-transport'
import type { AiTransport } from './transport'
import type { UtterancePartial } from './utterance'
import { STEERING_MAX_AGE_MS, steeringSignalFor } from './steering'
import {
  commitAnswer,
  createSession,
  deleteSession as deleteSessionRow,
  getSession as getSessionDetail,
  listSessions as listSessionRows,
  loadSession,
  transcript as loadTranscript,
  type InterviewSessionDetail,
  type InterviewSessionSummary,
  type StoredInterviewSession
} from '../db/repositories/interview'

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

export interface UtteranceStreamSink {
  transport?: AiTransport
  signal?: AbortSignal
  onPartial?: (partial: UtterancePartial) => void
}

function composeStream(
  input: ConversationInput,
  sink?: UtteranceStreamSink
): Promise<string> {
  return composeUtteranceStream(input, {
    ...sink,
    transport: sink?.transport ?? resolveTransport()
  })
}

export interface InterviewStep {
  sessionId: string
  utterance: string
  action: InterviewAction
  phase: InterviewState['phase']
  done: boolean
  report: InterviewReport | null
}

function requireSession(id: string): StoredInterviewSession {
  const session = loadSession(id)
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

function toConversationInput(
  state: InterviewState,
  action: InterviewAction,
  candidateName?: string
): ConversationInput {
  const input: ConversationInput = { action, candidateName }
  if (action.kind === 'probe' || action.kind === 'transition') {
    input.topicLabel = topicById(state, action.topicId)?.label
  }
  if (action.kind === 'transition' && action.callback) {
    input.callbackNote = callbackNote(state, action.topicId)
  }
  return input
}

function evaluatorInputFor(session: StoredInterviewSession, answer: string): EvaluatorInput | null {
  const action = session.lastAction
  if (action.kind !== 'probe' && action.kind !== 'transition') return null
  const topic = topicById(session.state, action.topicId)
  return {
    topicId: action.topicId,
    topicLabel: topic?.label ?? action.topicId,
    question: session.lastUtterance,
    answer,
    level: session.state.candidate.level,
    turn: session.state.turnCount
  }
}

async function evaluationFor(
  session: StoredInterviewSession,
  answer: string,
  client?: ParseClient
): Promise<AnswerEvaluation> {
  const input = evaluatorInputFor(session, answer)
  if (!input) return EMPTY_EVALUATION
  return evaluateAnswer(input, client)
}

export async function steerFromTranscript(
  sessionId: string,
  text: string,
  client?: ParseClient
): Promise<AnswerEvaluation> {
  const answer = text.trim()
  if (!answer) return EMPTY_EVALUATION
  const session = loadSession(sessionId)
  if (!session || session.state.phase === 'done') return EMPTY_EVALUATION
  return evaluationFor(session, answer, client)
}

function toStep(
  session: Pick<StoredInterviewSession, 'id' | 'lastUtterance' | 'lastAction' | 'state' | 'report'>
): InterviewStep {
  return {
    sessionId: session.id,
    utterance: session.lastUtterance,
    action: session.lastAction,
    phase: session.state.phase,
    done: session.state.phase === 'done',
    report: session.report
  }
}

export async function startInterview(
  input: StartInterviewInput,
  client?: ParseClient,
  sink?: UtteranceStreamSink
): Promise<InterviewStep> {
  const roadmap = await buildRoadmap(
    { resumeText: input.resumeText, experiences: input.experiences },
    client
  )
  const state = reduce(
    initState(roadmap, {
      budgetMs: input.budgetMs,
      closingReserveMs: input.closingReserveMs,
      candidate: input.level ? { level: input.level } : undefined
    }),
    { type: 'start' }
  )
  const action = selectAction(state)
  const utterance = await composeStream(
    toConversationInput(state, action, input.candidateName),
    sink
  )
  const id = createSession({
    candidateName: input.candidateName ?? null,
    level: state.candidate.level,
    state,
    lastAction: action,
    lastUtterance: utterance,
    startedAtMs: Date.now()
  })
  return toStep({ id, lastUtterance: utterance, lastAction: action, state, report: null })
}

export async function answerInterview(
  input: AnswerInterviewInput,
  client?: ParseClient,
  sink?: UtteranceStreamSink
): Promise<InterviewStep> {
  const session = requireSession(input.sessionId)
  if (session.state.phase === 'done') throw new Error('this interview has ended')
  const answer = input.answer.trim()
  if (!answer) throw new Error('an answer is required')

  const now = Date.now()
  const elapsedMs = input.elapsedMs ?? now - session.startedAtMs
  const evaluation =
    steeringSignalFor(session.id, now, STEERING_MAX_AGE_MS)?.evaluation ??
    (await evaluationFor(session, answer, client))
  let state = reduce(session.state, { type: 'answer', elapsedMs, evaluation })

  const action = selectAction(state)
  // Emitting a closing action IS the single closing prompt — mark it asked so the
  // next turn advances to done instead of asking to close twice.
  if (action.kind === 'closing') state = { ...state, closingAsked: true }

  const utterance = await composeStream(
    toConversationInput(state, action, session.candidateName ?? undefined),
    sink
  )

  let report: InterviewReport | null = session.report
  if (state.phase === 'done') {
    const transcript: TranscriptTurn[] = [
      ...loadTranscript(session.id),
      { speaker: 'candidate', text: answer },
      { speaker: 'interviewer', text: utterance }
    ]
    report = await summarizeInterview(
      { transcript, roadmap: state.roadmap, candidate: state.candidate },
      client
    )
  }

  commitAnswer({
    sessionId: session.id,
    answer,
    state,
    lastAction: action,
    lastUtterance: utterance,
    report
  })
  return toStep({ id: session.id, lastUtterance: utterance, lastAction: action, state, report })
}

export function getInterviewReport(sessionId: string): InterviewReport | null {
  return requireSession(sessionId).report
}

export function listInterviewSessions(): InterviewSessionSummary[] {
  return listSessionRows()
}

export function getInterviewSession(sessionId: string): InterviewSessionDetail | null {
  return getSessionDetail(sessionId)
}

export function deleteInterviewSession(sessionId: string): { deleted: boolean } {
  return deleteSessionRow(sessionId)
}
