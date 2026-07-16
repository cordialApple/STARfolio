export type TurnMode = 'auto' | 'ptt'
export type TurnPhase = 'listening' | 'thinking' | 'speaking'

export interface TurnTranscript {
  text: string
  isFinal: boolean
}

export type SubmitTurn = (text: string) => void

export class TurnController {
  private phase: TurnPhase = 'listening'

  constructor(
    private readonly submit: SubmitTurn,
    private mode: TurnMode = 'auto'
  ) {}

  get currentPhase(): TurnPhase {
    return this.phase
  }

  get currentMode(): TurnMode {
    return this.mode
  }

  setMode(mode: TurnMode): void {
    this.mode = mode
  }

  onTranscript(event: TurnTranscript): void {
    if (this.mode !== 'auto' || this.phase !== 'listening' || !event.isFinal) return
    this.dispatch(event.text)
  }

  submitManual(text: string): void {
    if (this.phase !== 'listening') return
    this.dispatch(text)
  }

  beginSpeaking(): void {
    this.phase = 'speaking'
  }

  endSpeaking(): void {
    this.phase = 'listening'
  }

  reset(): void {
    this.phase = 'listening'
  }

  private dispatch(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.phase = 'thinking'
    this.submit(trimmed)
  }
}
