import { z } from 'zod'
import { type IpcMain, type WebContents } from 'electron'
import { handle, nonEmpty, sessionArg } from './shared'
import { startPractice, answerPractice, answerArg } from '../practice'
import { startTechnical, answerTechnical, technicalAnswerArg } from '../technical'
import { practiceConfig } from '../ai/interview'
import { technicalConfig } from '../ai/technical'
import {
  startInterview,
  answerInterview,
  getInterviewReport,
  listInterviewSessions,
  getInterviewSession,
  deleteInterviewSession,
  type UtteranceStreamSink
} from '../ai/session'
import { partialToDelta } from '../ai/utterance'
import {
  getSession,
  listSessions,
  endSession,
  deleteSession,
  getTechnicalSession,
  listTechnicalSessions,
  endTechnicalSession,
  deleteTechnicalSession
} from '../db/repositories/practice'
import { getExperienceStore } from '../store/experience-store'

function utteranceSink(sender: WebContents, requestId?: string): UtteranceStreamSink | undefined {
  if (!requestId) return undefined
  const send = (channel: string, ...args: unknown[]): void => {
    if (!sender.isDestroyed()) sender.send(channel, requestId, ...args)
  }
  return {
    onPartial: partialToDelta(
      (delta) => send('ai:token', delta),
      () => send('ai:done')
    )
  }
}

export function registerSessions(ipcMain: IpcMain): void {
  handle(ipcMain, 'practice:start', practiceConfig, (_e, config) => startPractice(config))
  handle(ipcMain, 'practice:answer', answerArg, (_e, arg) => answerPractice(arg))
  handle(ipcMain, 'practice:end', sessionArg, (_e, { sessionId }) => endSession(sessionId))
  handle(ipcMain, 'practice:delete', sessionArg, (_e, { sessionId }) => deleteSession(sessionId))
  handle(ipcMain, 'practice:get', sessionArg, (_e, { sessionId }) => getSession(sessionId))
  ipcMain.handle('practice:list', () => listSessions())

  handle(ipcMain, 'technical:start', technicalConfig, (_e, config) => startTechnical(config))
  handle(ipcMain, 'technical:answer', technicalAnswerArg, (_e, arg) => answerTechnical(arg))
  handle(ipcMain, 'technical:get', sessionArg, (_e, { sessionId }) => getTechnicalSession(sessionId))
  handle(ipcMain, 'technical:end', sessionArg, (_e, { sessionId }) => endTechnicalSession(sessionId))
  handle(ipcMain, 'technical:delete', sessionArg, (_e, { sessionId }) => deleteTechnicalSession(sessionId))
  ipcMain.handle('technical:list', () => listTechnicalSessions())

  const MAX_INTERVIEW_EXPERIENCES = 40
  // Resume the roadmap from our own confirmed bank — never trust a renderer-supplied experience list.
  const interviewBank = (): { id: string; title: string; summary: string }[] =>
    getExperienceStore()
      .list({ status: 'confirmed' })
      .slice(0, MAX_INTERVIEW_EXPERIENCES)
      .map((e) => ({ id: e.id, title: e.title, summary: e.snippet }))
  const interviewStartArg = z.object({
    resumeText: z.string().trim().min(1).max(200_000),
    candidateName: z.string().trim().max(200).optional(),
    level: z.enum(['entry', 'mid', 'senior']).optional(),
    requestId: nonEmpty.max(64).optional()
  })
  const interviewAnswerArg = z.object({
    sessionId: nonEmpty.max(64),
    answer: z.string().trim().min(1).max(20_000),
    elapsedMs: z.number().min(0).optional(),
    requestId: nonEmpty.max(64).optional()
  })
  handle(ipcMain, 'interview:start', interviewStartArg, (event, { requestId, ...arg }) =>
    startInterview({ ...arg, experiences: interviewBank() }, undefined, utteranceSink(event.sender, requestId))
  )
  handle(ipcMain, 'interview:answer', interviewAnswerArg, (event, { requestId, ...arg }) =>
    answerInterview(arg, undefined, utteranceSink(event.sender, requestId))
  )
  handle(ipcMain, 'interview:report', sessionArg, (_e, { sessionId }) => getInterviewReport(sessionId))
  ipcMain.handle('interview:list', () => listInterviewSessions())
  handle(ipcMain, 'interview:get', sessionArg, (_e, { sessionId }) => getInterviewSession(sessionId))
  handle(ipcMain, 'interview:delete', sessionArg, (_e, { sessionId }) => deleteInterviewSession(sessionId))
}
