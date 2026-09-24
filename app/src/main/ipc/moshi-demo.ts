import { loadMoshiInterview } from '../db/repositories/moshi-interview'
import { app } from 'electron'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import { z } from 'zod'
import { handle } from './shared'
import { getExperienceStore } from '../store/experience-store'
import { MoshiDemoSession, selectDemoEvidence, checkDemoHealth } from '../voice/moshi/demo'
import { startMoshiInterview, compareMoshiSessionRigor } from '../ai/moshi-interview'
import { interviewRuntime } from '../ai/runtime'
import { getPrefs } from '../settings/prefs'
import { TrialCapture } from '../voice/moshi/trial-capture'

type Brain = Awaited<ReturnType<typeof startMoshiInterview>>
type Conditioning = Parameters<MoshiDemoSession['condition']>[0]

interface ActiveInterview {
  id: string
  mouth?: MoshiDemoSession
  brain?: Brain
  conditioning?: Conditioning
  cancelled: boolean
  finishing?: Promise<void>
  mouthEnded?: boolean
  endReason?: string
  capture?: TrialCapture
  record: (action: (capture: TrialCapture) => void) => void
  transportEnded?: () => void
  close: (reason?: string) => Promise<void>
}

function assertRemoteMoshiEnabled(): void {
  if (!getPrefs().experimentalRemoteMoshiEnabled) throw new Error('Remote MoshiRAG is disabled')
}

export function registerMoshiDemo(ipcMain: IpcMain): void {
  handle(
    ipcMain,
    'moshiDemo:health',
    z.object({ endpoint: z.string().max(200) }),
    async (_event, request) => {
      assertRemoteMoshiEnabled()
      return checkDemoHealth(request.endpoint)
    }
  )
  const replaying = new Map<string, Promise<unknown>>()
  const savedSessionArg = z.object({ sessionId: z.string().min(1).max(64) })
  handle(ipcMain, 'moshiDemo:audit', savedSessionArg, (_event, { sessionId }) =>
    loadMoshiInterview(sessionId)
  )
  handle(ipcMain, 'moshiDemo:rigor', savedSessionArg, async (_event, { sessionId }) => {
    assertRemoteMoshiEnabled()
    const existing = replaying.get(sessionId)
    if (existing) return existing
    const snapshot = loadMoshiInterview(sessionId)
    if (!snapshot || snapshot.status !== 'finished')
      throw new Error('A finished native interview is required')
    const options =
      snapshot.mode === 'stub'
        ? { stub: true }
        : interviewRuntime(undefined, { conversation: false }).evaluator
    const replay = compareMoshiSessionRigor(snapshot, options).finally(() =>
      replaying.delete(sessionId)
    )
    replaying.set(sessionId, replay)
    return replay
  })
  const sessions = new Map<number, ActiveInterview>()
  handle(
    ipcMain,
    'moshiDemo:start',
    z.object({
      sessionId: z.string().min(1).max(64),
      endpoint: z.string().max(200),
      experienceIds: z.array(z.string().min(1).max(64)).min(1).max(12),
      durationSeconds: z.number().int().min(60).max(1800),
      resumeText: z.string().trim().min(1).max(200_000),
      jobDescription: z.string().trim().max(20_000).optional(),
      candidateName: z.string().trim().max(200).optional(),
      recordTrialMedia: z.boolean().optional(),
      consent: z.literal(true)
    }),
    async (event, request) => {
      assertRemoteMoshiEnabled()
      const owner = event.sender
      const startedMs = performance.now()
      const startedAtUtc = new Date().toISOString()
      if (sessions.has(owner.id)) throw new Error('End the active interview first')
      const send = (message: object): void => {
        if (!owner.isDestroyed())
          owner.send('moshiDemo:event', { ...message, sessionId: request.sessionId })
      }
      const startupAbort = new AbortController()
      const record = (action: (capture: TrialCapture) => void): void => {
        if (!current.capture) return
        try {
          action(current.capture)
        } catch {
          const failed = current.capture
          current.capture = undefined
          void failed.finish('Trial capture failed', false).catch(() => undefined)
          send({ type: 'capture-warning', message: 'Trial capture failed; interview continues' })
        }
      }
      const current: ActiveInterview = {
        id: request.sessionId,
        cancelled: false,
        record,
        close: (reason = 'Ended by user') => {
          if (current.finishing) return current.finishing
          current.endReason = reason
          current.cancelled = true
          if (!current.brain) startupAbort.abort()
          current.finishing = Promise.resolve().then(async () => {
            let reportFinished = false
            const mouth = current.mouth
            if (mouth && !current.mouthEnded) {
              await new Promise<void>((resolve) => {
                current.transportEnded = resolve
                mouth.end(reason)
              })
            }
            try {
              if (current.brain) {
                const snapshot = await current.brain.finish(current.endReason ?? reason)
                reportFinished = snapshot.status === 'finished'
                send({ type: 'interview', snapshot })
              }
            } catch (error) {
              current.brain?.cancel()
              send({
                type: 'error',
                message:
                  error instanceof Error ? error.message : 'Could not finish interview report'
              })
            } finally {
              try {
                await current.capture?.finish(
                  current.endReason ?? reason,
                  reportFinished && (current.endReason ?? reason) === 'Ended by user'
                )
              } catch {
                send({ type: 'capture-warning', message: 'Trial capture could not finish' })
              }
              if (sessions.get(owner.id) === current) sessions.delete(owner.id)
              owner.removeListener('destroyed', stop)
              owner.removeListener('render-process-gone', stop)
              owner.removeListener('did-start-navigation', stop)
              send({ type: 'ended', reason: current.endReason ?? reason })
            }
          })
          return current.finishing
        }
      }
      const stop = (): void => {
        void current.close('Window closed or reloaded')
      }
      const assertActive = (): void => {
        if (current.cancelled || owner.isDestroyed())
          throw new Error('Interview ended before it became ready')
      }
      sessions.set(owner.id, current)
      owner.once('destroyed', stop)
      owner.once('render-process-gone', stop)
      owner.once('did-start-navigation', stop)
      try {
        const health = await checkDemoHealth(request.endpoint)
        assertActive()
        if (!health.upstreamReady || health.busy)
          throw new Error('Moshi worker is not ready or is busy')
        if (health.mode === 'moshi') {
          try {
            current.capture = new TrialCapture({
              root: join(app.getPath('userData'), 'moshi-trials'),
              sessionId: request.sessionId,
              trialId: health.trialId ?? null,
              recordMedia: request.recordTrialMedia === true,
              startedMs,
              startedAtUtc,
              onMediaError: () =>
                send({
                  type: 'capture-warning',
                  message: 'Trial media write failed; interview continues'
                })
            })
            record((capture) => capture.phase('health'))
          } catch {
            send({
              type: 'capture-warning',
              message: 'Trial capture unavailable; interview continues'
            })
          }
        }
        const evidence = selectDemoEvidence(request.experienceIds, (id) =>
          getExperienceStore().get(id)
        )
        const runtime =
          health.mode === 'fixture'
            ? { architect: { stub: true }, evaluator: { stub: true } }
            : interviewRuntime(undefined, { conversation: false })
        const brain = await startMoshiInterview(
          {
            resumeText: request.resumeText,
            jobDescription: request.jobDescription,
            candidateName: request.candidateName,
            experiences: evidence.map((item) => ({
              id: item.id,
              title: item.title,
              summary: item.text
            })),
            level: 'entry',
            budgetMs: request.durationSeconds * 1000,
            closingReserveMs: Math.min(60_000, request.durationSeconds * 100)
          },
          runtime,
          {
            signal: startupAbort.signal,
            onConditioning: (conditioning) => {
              if (current.cancelled) return
              current.conditioning = conditioning
              current.mouth?.condition(conditioning)
            },
            onUpdate: (snapshot) => {
              if (sessions.get(owner.id) === current) send({ type: 'interview', snapshot })
              if (snapshot.status === 'failed')
                void current.close(snapshot.error ?? 'Interview scoring failed')
            }
          }
        )
        if (current.cancelled || owner.isDestroyed()) {
          brain.cancel()
          throw new Error('Interview ended before it became ready')
        }
        current.brain = brain
        record((capture) => capture.phase('brain'))
        send({ type: 'interview', snapshot: brain.snapshot() })
        const mouth = new MoshiDemoSession(
          (message) => {
            if (sessions.get(owner.id) !== current) return
            if (message.type === 'ended') {
              current.mouthEnded = true
              const endReason =
                current.endReason ??
                `Remote session ended before local audio drain; transcript incomplete: ${message.reason}`
              current.endReason = endReason
              if (current.transportEnded) current.transportEnded()
              else void current.close(endReason)
              return
            }
            if (current.cancelled && message.type !== 'segment') return
            if (message.type === 'segment') {
              const { type: _type, ...segment } = message
              brain.appendSegment(segment)
            } else if (message.type === 'gap') {
              record((capture) => capture.gap())
              void brain.gap().catch((error: unknown) => {
                send({
                  type: 'error',
                  message: error instanceof Error ? error.message : 'Interview scoring failed'
                })
                void current.close('Interview scoring failed')
              })
            } else if (message.type === 'conditioning') {
              brain.recordConditioningDelivery(message.revision, message.status, message.reason)
            } else {
              if (message.type === 'ready') record((capture) => capture.phase('ready'))
              if (message.type === 'audio') record((capture) => capture.output(message.samples))
              send(message)
            }
          },
          (durationMs) => record((capture) => capture.ping(durationMs))
        )
        current.mouth = mouth
        const mode = await mouth.start(
          request.endpoint,
          evidence,
          request.durationSeconds,
          current.conditioning
        )
        assertActive()
        if (mode !== health.mode) throw new Error('Worker mode changed during startup; reconnect')
        return mode
      } catch (error) {
        await current.close('Interview startup failed')
        throw error
      }
    }
  )
  ipcMain.on('moshiDemo:audio', (event, input: unknown) => {
    if (!input || typeof input !== 'object') return
    const { sessionId, samples } = input as { sessionId?: unknown; samples?: unknown }
    const current = sessions.get(event.sender.id)
    if (
      current &&
      !current.cancelled &&
      current.id === sessionId &&
      samples instanceof Float32Array
    ) {
      current.mouth?.audio(samples)
      current.record((capture) => capture.input(samples))
    }
  })
  handle(
    ipcMain,
    'moshiDemo:end',
    savedSessionArg.extend({
      reason: z.string().trim().min(1).max(200).optional()
    }),
    (event, { sessionId, reason }) => {
      const current = sessions.get(event.sender.id)
      if (current?.id === sessionId) return current.close(reason)
      return undefined
    }
  )
}
