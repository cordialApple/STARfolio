import { useCallback, useEffect, useRef, useState } from 'react'
import { startRecording, type Recording } from '../audio/recorder'
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

  const recRef = useRef<Recording | null>(null)
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
    const rec = recRef.current
    recRef.current = null
    setListening(false)
    setStarting(false)
    setUtteranceActive(false)
    setPartial(null)
    controllerRef.current?.reset()
    window.api.voice.streamStop()
    await rec?.stop()
  }, [])

  const start = useCallback(async () => {
    if (recRef.current || starting) return
    setStarting(true)
    setError(null)
    controllerRef.current?.reset()
    try {
      window.api.voice.streamStart(sessionIdRef.current ?? undefined)
      recRef.current = await startRecording({
        onFrames: (frames) => window.api.voice.streamFrames(frames),
        batchSamples: STREAM_BATCH_SAMPLES
      })
      setListening(true)
    } catch (err) {
      window.api.voice.streamStop()
      const e = err as Error
      setError(
        e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Enable it in Windows Settings › Privacy › Microphone, then retry.'
          : `Could not start listening: ${e.message}`
      )
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
    if (ready && recRef.current) controllerRef.current?.reset()
  }, [ready])

  useEffect(() => {
    return () => {
      window.api.voice.streamStop()
      void recRef.current?.stop()
      recRef.current = null
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { listening, starting, partial, utteranceActive, error, start, stop, clearError }
}
