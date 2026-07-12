import { z } from 'zod'
import {
  technicalConfig,
  firstTechnicalQuestion,
  evaluateTechnicalAnswer,
  type TechnicalConfig,
  type TechnicalFeedback
} from './ai/technical'
import { searchCorpus, type CorpusHit } from './search'
import {
  createSession,
  addInterviewerTurn,
  commitAnswer,
  isSessionOpen,
  currentQuestion,
  askedQuestions,
  rawSessionConfig
} from './db/repositories/practice'

export const technicalAnswerArg = z.object({
  sessionId: z.string().min(1).max(64),
  answer: z.string().trim().min(1).max(20_000)
})

export interface Citation {
  chunkId: string
  title: string
}
export interface TechnicalStartResult {
  sessionId: string
  question: string
  citations: Citation[]
}
export interface TechnicalAnswerResult {
  feedback: TechnicalFeedback
  next_kind: 'drilldown' | 'question' | 'done'
  next_text: string
  citations: Citation[]
}

const MAX_CHUNKS = 6

function retrievalQuery(config: TechnicalConfig, question?: string): string {
  return question ? `${config.promptText}\n${question}` : config.promptText
}

function citationsFor(cited: string[], chunks: CorpusHit[]): Citation[] {
  const byId = new Map(chunks.map((c) => [c.chunkId, c.title]))
  return cited.map((chunkId) => ({ chunkId, title: byId.get(chunkId) ?? 'Corpus' }))
}

function loadConfig(sessionId: string): TechnicalConfig | null {
  const raw = rawSessionConfig(sessionId)
  if (!raw) return null
  try {
    return technicalConfig.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function startTechnical(rawConfig: unknown): Promise<TechnicalStartResult> {
  const config = technicalConfig.parse(rawConfig)
  const chunks = await searchCorpus(retrievalQuery(config), config.discipline, MAX_CHUNKS)
  if (chunks.length === 0)
    throw new Error('No corpus material found — add reference documents (and let them finish indexing) first.')

  const { question, cited_chunk_ids } = await firstTechnicalQuestion(config, chunks)
  const sessionId = createSession(config, 'technical')
  addInterviewerTurn(sessionId, question, cited_chunk_ids)
  return { sessionId, question, citations: citationsFor(cited_chunk_ids, chunks) }
}

export async function answerTechnical(
  arg: z.infer<typeof technicalAnswerArg>
): Promise<TechnicalAnswerResult> {
  const config = loadConfig(arg.sessionId)
  if (!config) throw new Error('technical session not found')
  if (!isSessionOpen(arg.sessionId)) throw new Error('this session has ended')
  const question = currentQuestion(arg.sessionId)
  if (!question) throw new Error('no question to answer yet')

  let chunks = await searchCorpus(retrievalQuery(config, question), config.discipline, MAX_CHUNKS)
  // Broaden if the scoped query found nothing, so a follow-up can still cite real material.
  if (chunks.length === 0) chunks = await searchCorpus(config.promptText, undefined, MAX_CHUNKS)

  const turn = await evaluateTechnicalAnswer({
    config,
    chunks,
    asked: askedQuestions(arg.sessionId),
    question,
    answer: arg.answer
  })

  // Checkpoint invariant: a follow-up question must cite >=1 chunk. If retrieval came up empty
  // (e.g. the corpus was emptied mid-session), end the session rather than emit a citation-less
  // question — ensureCited already guarantees a real citation whenever chunks exist.
  const nextText = turn.next_text.trim()
  const ask = turn.next_kind !== 'done' && !!nextText && turn.cited_chunk_ids.length > 0
  commitAnswer({
    sessionId: arg.sessionId,
    answer: arg.answer,
    feedback: turn.feedback,
    flags: {},
    experienceIds: [],
    next: ask ? { kind: 'ask', text: nextText, chunkIds: turn.cited_chunk_ids } : { kind: 'done' }
  })

  return {
    feedback: turn.feedback,
    next_kind: ask ? turn.next_kind : 'done',
    next_text: ask ? nextText : '',
    citations: ask ? citationsFor(turn.cited_chunk_ids, chunks) : []
  }
}
