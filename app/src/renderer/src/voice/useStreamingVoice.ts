import { useCallback, useEffect, useRef, useState } from 'react'
import { startRecording } from '../audio/recorder'
import { micErrorMessage } from './mic-error'
import { StreamingRecordingSession } from './streaming-recording-session'
import { TurnController } from './turn-controller'
import type { TranscriptEvent } from '../lib/bank-types'

const STREAM_BATCH_SAMPLES = 1600

export interface UseStreamingVoice {
  listening: boolean
  starting: boolean
  partial: TranscriptEvent | null
  utteranceActive: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  clearError: () => void
}

export function useStreamingVoice(
  submit: (text: string) => void,
  ready: boolean,
  sessionId?: string | null
): UseStreamingVoice {
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [partial, setPartial] = useState<TranscriptEvent | null>(null)
  const [utteranceActive, setUtteranceActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionRef = useRef<StreamingRecordingSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = new StreamingRecordingSession(
      (onFrames) => startRecording({ onFrames, batchSamples: STREAM_BATCH_SAMPLES }),
      {
        start: (id) => window.api.voice.streamStart(id),
        send: (frames) => window.api.voice.streamFrames(frames),
        stop: () => window.api.voice.streamStop()
      }
    )
  }
  const submitRef = useRef(submit)
  submitRef.current = submit
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const controllerRef = useRef<TurnController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new TurnController((text) => {
      setPartial(null)
      submitRef.current(text)
    }, 'auto')
  }

  const stop = useCallback(async () => {
    setListening(false)
    setStarting(false)
    setUtteranceActive(false)
    setPartial(null)
    controllerRef.current?.reset()
    try {
      await sessionRef.current?.stop()
    } catch (err) {
      setError(micErrorMessage(err))
    }
  }, [])

  const start = useCallback(async () => {
    if (starting) return
    setStarting(true)
    setError(null)
    controllerRef.current?.reset()
    try {
      const started = await sessionRef.current?.start(sessionIdRef.current ?? undefined)
      if (started) setListening(true)
    } catch (err) {
      setError(micErrorMessage(err))
    } finally {
      setStarting(false)
    }
  }, [starting])

  useEffect(() => {
    const offPartial = window.api.voice.onPartial((event: TranscriptEvent) => {
      setPartial(event)
      if (event.isFinal) {
        controllerRef.current?.onTranscript({ text: event.text, isFinal: true })
      }
    })
    const offUtterance = window.api.voice.onUtterance((event) => {
      setUtteranceActive(event.kind === 'utteranceStart')
    })
    return () => {
      offPartial()
      offUtterance()
    }
  }, [])

  useEffect(() => {
    if (ready && listening) controllerRef.current?.reset()
  }, [ready, listening])

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop().catch(() => undefined)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { listening, starting, partial, utteranceActive, error, start, stop, clearError }
}
