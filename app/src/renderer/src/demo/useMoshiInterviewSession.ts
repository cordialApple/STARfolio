import { useCallback, useEffect, useRef, useState } from 'react'
import { startRecording, type Recording } from '../audio/recorder'
import { shouldCaptureDemoAudio } from './capture-mode'
import { createLatencySession, type LatencySession } from './latency-session'
import { playScriptedAudio } from './scripted-playback'
import type {
  ExperienceSummary,
  MoshiDemoEvent,
  MoshiInterviewSnapshot
} from '../../../preload/index.d'

interface MoshiInterviewSessionOptions {
  resumeText: string
  candidateName: string
  endpoint: string
  experienceIds: string[]
  durationSeconds: number
  jobDescription: string
  consent: boolean
  recordTrialMedia: boolean
  localProvidersOnly: boolean
}

function captureDrainFailureMessage(failure: unknown): string {
  return `Interview ended incomplete because audio capture did not drain: ${captureDrainError(failure).message}`
}

function captureDrainError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error('Unknown audio capture failure')
}

function scheduledOutputTiming(context: AudioContext, when: number, receivedAtMs: number): {
  receivedAtMs: number
  scheduledStartMs: number
  clockSource: 'audio-output-timestamp' | 'renderer-fallback'
} {
  const outputStamp = context.getOutputTimestamp?.()
  const outputContextTime = outputStamp?.contextTime
  const outputPerformanceTime = outputStamp?.performanceTime
  const hasOutputTimestamp =
    typeof outputContextTime === 'number' &&
    typeof outputPerformanceTime === 'number' &&
    Number.isFinite(outputContextTime) &&
    Number.isFinite(outputPerformanceTime) &&
    outputPerformanceTime > 0
  const scheduledStartMs = hasOutputTimestamp
    ? outputPerformanceTime + (when - outputContextTime) * 1000
    : performance.now() + Math.max(0, when - context.currentTime) * 1000
  return {
    receivedAtMs,
    scheduledStartMs,
    clockSource: hasOutputTimestamp ? 'audio-output-timestamp' : 'renderer-fallback'
  }
}

export interface MoshiInterviewSession {
  bank: ExperienceSummary[]
  status: string
  checking: boolean
  connection: string
  mode: 'moshi' | 'fixture' | null
  active: boolean
  ending: boolean
  snapshot: MoshiInterviewSnapshot | null
  level: number
  start: () => Promise<void>
  checkConnection: () => Promise<void>
  requestEnd: () => Promise<void>
}

export function useMoshiInterviewSession({
  resumeText,
  candidateName,
  endpoint,
  experienceIds,
  durationSeconds,
  jobDescription,
  consent,
  recordTrialMedia,
  localProvidersOnly
}: MoshiInterviewSessionOptions): MoshiInterviewSession {
  const [bank, setBank] = useState<ExperienceSummary[]>([])
  const [status, setStatus] = useState('Ready to connect')
  const [checking, setChecking] = useState(false)
  const [connection, setConnection] = useState('Connection not checked')
  const [mode, setMode] = useState<'moshi' | 'fixture' | null>(null)
  const [active, setActive] = useState(false)
  const [ending, setEnding] = useState(false)
  const [snapshot, setSnapshot] = useState<MoshiInterviewSnapshot | null>(null)
  const [level, setLevel] = useState(0)
  const recording = useRef<Recording<void> | null>(null)
  const playback = useRef<AudioContext | null>(null)
  const nextAudioTime = useRef(0)
  const generation = useRef(0)
  const sessionId = useRef<string | null>(null)
  const isCaptureLive = useRef(false)
  const stoppingAudio = useRef<Promise<void> | null>(null)
  const startingCapture = useRef<Promise<void> | null>(null)
  const endingSession = useRef<Promise<void> | null>(null)
  const latencySession = useRef<LatencySession | null>(null)
  const pendingScript = useRef<{ revision: number; kind: 'ask_intro' | 'closing' | 'done'; samples: Float32Array } | null>(null)
  const scriptSpeaking = useRef(false)
  const scriptAbort = useRef<AbortController | null>(null)
  const openingCompleted = useRef(false)

  const stopAudio = useCallback(async (): Promise<void> => {
    if (stoppingAudio.current) return stoppingAudio.current
    generation.current++
    scriptAbort.current?.abort()
    scriptAbort.current = null
    pendingScript.current = null
    const mic = recording.current
    recording.current = null
    const context = playback.current
    playback.current = null
    nextAudioTime.current = 0
    const pending = Promise.allSettled([
      mic?.stop(),
      context && context.state !== 'closed' ? context.close() : undefined
    ]).then((results) => {
      latencySession.current?.finish()
      latencySession.current = null
      isCaptureLive.current = false
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
    stoppingAudio.current = pending
    try {
      await pending
    } finally {
      if (stoppingAudio.current === pending) stoppingAudio.current = null
    }
  }, [])

  const drainCapture = useCallback(async (): Promise<void> => {
    const startup = startingCapture.current
    let failure: unknown
    let didFail = false
    try {
      await stopAudio()
    } catch (error) {
      failure = error
      didFail = true
    }
    try {
      await startup
    } catch (error) {
      failure ??= error
      didFail = true
    }
    try {
      await stopAudio()
    } catch (error) {
      failure ??= error
      didFail = true
    }
    if (didFail) throw captureDrainError(failure)
  }, [stopAudio])

  const finishSession = useCallback(
    async (id: string): Promise<void> => {
      let drainFailure: unknown
      try {
        await drainCapture()
      } catch (error) {
        drainFailure = error
      }
      await window.api.moshiDemo.end(id, drainFailure ? 'Final transcript flush failed' : undefined)
      if (drainFailure) throw new Error(captureDrainFailureMessage(drainFailure))
    },
    [drainCapture]
  )

  const requestEnd = useCallback((): Promise<void> => {
    if (endingSession.current) return endingSession.current
    setLevel(0)
    const id = sessionId.current
    if (!id) return drainCapture()
    setEnding(true)
    setStatus('Finishing remaining scores and saving report…')
    const pending = finishSession(id)
    endingSession.current = pending
      .catch((error: Error) => {
        if (sessionId.current === id) {
          sessionId.current = null
          setActive(false)
          setEnding(false)
          setStatus(error.message)
        }
      })
      .finally(() => {
        endingSession.current = null
      })
    return endingSession.current
  }, [drainCapture, finishSession])

  const playScript = useCallback((): void => {
    const script = pendingScript.current
    const id = sessionId.current
    const context = playback.current
    if (!script || !id || !context || context.state === 'closed' || !recording.current || !isCaptureLive.current || scriptSpeaking.current)
      return
    pendingScript.current = null
    scriptSpeaking.current = true
    const controller = new AbortController()
    scriptAbort.current = controller
    const receivedAtMs = performance.now()
    const when = Math.max(context.currentTime, nextAudioTime.current)
    nextAudioTime.current = when + script.samples.length / 24_000
    const outputTiming = scheduledOutputTiming(context, when, receivedAtMs)
    latencySession.current?.output(script.samples, outputTiming)
    setStatus('Speaking fixed interview line…')
    void playScriptedAudio(context, script.samples, when, controller.signal)
      .then(async () => {
        if (sessionId.current !== id) return
        const recorded = await window.api.moshiDemo.scriptedTurnDone(id, script.revision)
        if (!recorded) throw new Error('Scripted interview line was not accepted')
        if (sessionId.current !== id) return
        if (script.kind === 'ask_intro') openingCompleted.current = true
        if (script.kind === 'done') await requestEnd()
        else {
          scriptSpeaking.current = false
          setStatus('Live — scoring runs between speech segments')
        }
      })
      .catch((error: unknown) => {
        if (sessionId.current !== id || endingSession.current) return
        setStatus(error instanceof Error ? error.message : 'Scripted speech failed')
        void requestEnd()
      })
      .finally(() => {
        if (scriptAbort.current === controller) scriptAbort.current = null
      })
  }, [requestEnd])

  useEffect(() => {
    setMode(null)
    setConnection('Connection not checked')
  }, [endpoint])

  useEffect(() => {
    let mounted = true
    void window.api.bank
      .list({})
      .then((items) => {
        if (mounted) setBank(items)
      })
      .catch((error: Error) => {
        if (mounted) setStatus(error.message)
      })
    const unsubscribe = window.api.moshiDemo.onEvent((event: MoshiDemoEvent) => {
      if (event.sessionId !== sessionId.current) return
      if (event.type === 'interview') {
        setSnapshot(event.snapshot)
      } else if (event.type === 'scripted-turn') {
        pendingScript.current = {
          revision: event.revision,
          kind: event.kind,
          samples: new Float32Array(event.samples)
        }
        playScript()
      } else if (event.type === 'audio') {
        const context = playback.current
        if (!context || !isCaptureLive.current || context.state === 'closed') return
        if (nextAudioTime.current - context.currentTime > 2) {
          void requestEnd()
          setStatus('Playback fell behind; saving interview')
          return
        }
        const receivedAtMs = performance.now()
        const samples = new Float32Array(event.samples)
        const buffer = context.createBuffer(1, samples.length, 24000)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        const when = Math.max(context.currentTime, nextAudioTime.current)
        source.start(when)
        const outputTiming = scheduledOutputTiming(context, when, receivedAtMs)
        latencySession.current?.output(samples, outputTiming)
        nextAudioTime.current = when + buffer.duration
      } else if (event.type === 'ready') {
        setMode(event.mode)
        setStatus(
          event.mode === 'fixture'
            ? 'Local fixture; no microphone or live models'
            : 'Connected; opening microphone…'
        )
      } else if (event.type === 'error') {
        void requestEnd()
        setEnding(true)
        setStatus(event.message)
      } else if (event.type === 'capture-warning') {
        setStatus(event.message)
      } else if (event.type === 'ended') {
        void (async () => {
          let drainFailure: unknown
          try {
            await drainCapture()
          } catch (error) {
            drainFailure = error
          }
          if (endingSession.current) await endingSession.current
          if (sessionId.current !== event.sessionId) return
          sessionId.current = null
          setActive(false)
          setEnding(false)
          setLevel(0)
          setStatus(
            drainFailure
              ? captureDrainFailureMessage(drainFailure)
              : `Interview ended: ${event.reason}`
          )
        })()
      }
    })
    return () => {
      mounted = false
      unsubscribe()
      const id = sessionId.current
      void (id ? finishSession(id) : drainCapture())
        .catch(() => undefined)
        .finally(() => {
          if (sessionId.current === id) sessionId.current = null
        })
    }
  }, [drainCapture, finishSession, playScript, requestEnd])

  const start = useCallback(async (): Promise<void> => {
    if (!consent || !resumeText.trim() || sessionId.current) return
    const attempt = ++generation.current
    openingCompleted.current = false
    scriptSpeaking.current = false
    const id = crypto.randomUUID()
    sessionId.current = id
    setActive(true)
    setEnding(false)
    setSnapshot(null)
    setStatus('Checking worker and building interview roadmap…')
    const isCurrentAttempt = (): boolean =>
      generation.current === attempt && sessionId.current === id
    try {
      const context = new AudioContext()
      playback.current = context
      await context.resume()
      if (generation.current !== attempt) return
      const connectedMode = await window.api.moshiDemo.start({
        sessionId: id,
        endpoint,
        experienceIds,
        durationSeconds,
        resumeText,
        jobDescription: jobDescription.trim() || undefined,
        candidateName: candidateName.trim() || undefined,
        consent: true,
        recordTrialMedia,
        localProvidersOnly
      })
      if (!isCurrentAttempt()) return
      if (!shouldCaptureDemoAudio(connectedMode, consent)) {
        await context.close()
        if (generation.current !== attempt) return
        playback.current = null
        setStatus('Local fixture; no microphone or live models')
        return
      }
      isCaptureLive.current = true
      latencySession.current = createLatencySession({
        emit: (event) => window.api.moshiDemo.timing(id, event),
        now: () => performance.now(),
        timeOriginUtcMs: performance.timeOrigin
      })
      const pendingCapture = startRecording({
        sampleRate: 24000,
        batchSamples: 1920,
        onLevel: (value) => {
          if (sessionId.current === id) setLevel(value)
        },
        onFrames: (samples, timing) => {
          if (isCaptureLive.current && sessionId.current === id) {
            if (!openingCompleted.current || scriptSpeaking.current || pendingScript.current) {
              window.api.moshiDemo.audio(id, new Float32Array(samples.length))
            } else {
              if (timing) latencySession.current?.input(samples, timing)
              window.api.moshiDemo.audio(id, samples)
            }
          }
        }
      }).then(async (mic) => {
        if (!isCurrentAttempt()) {
          await mic.stop()
          return
        }
        recording.current = mic
        latencySession.current?.micReady()
        setStatus('Live — scoring runs between speech segments')
        playScript()
      })
      startingCapture.current = pendingCapture
      try {
        await pendingCapture
      } finally {
        if (startingCapture.current === pendingCapture) startingCapture.current = null
      }
    } catch (error) {
      if (sessionId.current !== id) return
      setStatus(error instanceof Error ? error.message : 'Could not start interview')
      void requestEnd()
    }
  }, [
    candidateName,
    consent,
    durationSeconds,
    endpoint,
    experienceIds,
    jobDescription,
    playScript,
    recordTrialMedia,
    localProvidersOnly,
    requestEnd,
    resumeText
  ])

  const checkConnection = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      const health = await window.api.moshiDemo.health(endpoint)
      setMode(health.mode)
      setConnection(
        `${health.mode === 'fixture' ? 'Local fixture — no model' : 'Moshi worker'} · ${health.upstreamReady ? 'upstream ready' : 'upstream not ready'} · ${health.busy ? 'busy' : 'available'}`
      )
    } catch (error) {
      setMode(null)
      setConnection(error instanceof Error ? error.message : 'Connection failed')
    } finally {
      setChecking(false)
    }
  }, [endpoint])

  return {
    bank,
    status,
    checking,
    connection,
    mode,
    active,
    ending,
    snapshot,
    level,
    start,
    checkConnection,
    requestEnd
  }
}
