import { useRef, useState } from 'react'
import { Mic, Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'
import { startRecording, type Recording } from '../audio/recorder'
import type { WhisperModelName } from '../lib/bank-types'

type Phase = 'idle' | 'recording' | 'transcribing'

export interface PushToTalkProps {
  model: WhisperModelName
  disabled?: boolean
  onTranscript: (text: string) => void
  onError: (message: string) => void
}

export function PushToTalk({
  model,
  disabled,
  onTranscript,
  onError
}: PushToTalkProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [level, setLevel] = useState(0)
  const recRef = useRef<Recording | null>(null)

  async function begin(): Promise<void> {
    if (phase !== 'idle' || disabled) return
    try {
      recRef.current = await startRecording({ onLevel: setLevel })
      setPhase('recording')
    } catch (err) {
      const e = err as Error
      onError(
        e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Enable it in Windows Settings › Privacy › Microphone, then retry.'
          : `Could not start recording: ${e.message}`
      )
      setPhase('idle')
    }
  }

  async function end(): Promise<void> {
    const rec = recRef.current
    if (phase !== 'recording' || !rec) return
    recRef.current = null
    setLevel(0)
    setPhase('transcribing')
    try {
      const pcm = await rec.stop()
      if (pcm.length === 0) {
        setPhase('idle')
        return
      }
      // On Windows a blocked mic can resolve getUserMedia with a silent (all-zero) stream
      // instead of throwing, so an all-zero capture means no audio reached us, not a quiet room.
      if (pcm.every((s) => s === 0)) {
        onError(
          'No audio was captured. Enable microphone access in Windows Settings › Privacy › Microphone, then retry.'
        )
        setPhase('idle')
        return
      }
      const text = await window.api.voice.transcribe(Array.from(pcm), model)
      onTranscript(text.trim())
    } catch (err) {
      onError(`Transcription failed: ${(err as Error).message}`)
    } finally {
      setPhase('idle')
    }
  }

  const meter = Math.min(100, Math.round(level * 400))

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled || phase === 'transcribing'}
        onPointerDown={() => void begin()}
        onPointerUp={() => void end()}
        onPointerLeave={() => void end()}
        aria-label={phase === 'recording' ? 'Release to transcribe' : 'Hold to talk'}
        className={cn(
          'inline-flex size-12 shrink-0 items-center justify-center rounded-full transition-colors',
          phase === 'recording'
            ? 'bg-danger-strong text-on-brand'
            : 'bg-brand-strong text-on-brand hover:brightness-95',
          (disabled || phase === 'transcribing') && 'pointer-events-none opacity-50'
        )}
      >
        {phase === 'transcribing' ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Mic className="size-5" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        {phase === 'recording' ? (
          <div className="h-2 w-full overflow-hidden rounded-pill bg-raised" role="presentation">
            <div
              className="h-full rounded-pill bg-danger transition-[width] duration-75"
              style={{ width: `${Math.max(4, meter)}%` }}
            />
          </div>
        ) : (
          <span className="text-xs text-muted">
            {phase === 'transcribing' ? 'Transcribing…' : 'Hold the mic to speak your answer'}
          </span>
        )}
      </div>
    </div>
  )
}
