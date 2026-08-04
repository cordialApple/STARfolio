import type { DirectedAction, InterviewAction } from '../roadmap'
import type { Mouth } from './conformance'
import { HalfDuplexGate, defaultHalfDuplexConfig } from '../../voice/streaming/half-duplex'
import type { HalfDuplexConfig } from '../../voice/streaming/half-duplex'

export interface TurnBrain {
  plan(): DirectedAction[]
}

export interface Phraser {
  phrase(intent: InterviewAction): string
}

export interface TtsMouthSink {
  speak(text: string): void
  finish(): number
}

export interface RealizedTurn {
  index: number
  plan: DirectedAction[]
  realized: DirectedAction[]
  lines: string[]
  marker: number
}

export type TurnPhase = 'listening' | 'speaking'

export interface TurnLoopPorts {
  brain: TurnBrain
  mouth: Mouth
  phraser: Phraser
  tts: TtsMouthSink
  halfDuplex?: HalfDuplexConfig
  now?: () => number
}

export const stubPhraser: Phraser = {
  phrase(intent) {
    switch (intent.kind) {
      case 'ask_intro':
        return 'Tell me about a project you owned end to end.'
      case 'probe':
        return `Say more about ${intent.dimension}.`
      case 'transition':
        return intent.callback ? "Circling back — you mentioned something I want to revisit." : "Let's move on."
      case 'closing':
        return 'Anything you wish I had asked?'
      case 'done':
        return 'Thanks — that wraps us up.'
    }
  }
}

export class TurnLoop {
  private readonly gate: HalfDuplexGate
  private readonly now: () => number
  private phase: TurnPhase = 'listening'
  private turnSeq = 0
  private pendingMarker: number | null = null
  private readonly log: RealizedTurn[] = []

  constructor(private readonly ports: TurnLoopPorts) {
    this.gate = new HalfDuplexGate(ports.halfDuplex ?? defaultHalfDuplexConfig())
    this.now = ports.now ?? (() => Date.now())
  }

  get state(): TurnPhase {
    return this.phase
  }

  get speaking(): boolean {
    return this.phase === 'speaking'
  }

  turns(): readonly RealizedTurn[] {
    return this.log
  }

  captureOpen(now = this.now()): boolean {
    return this.phase === 'listening' && this.gate.isCaptureOpen(now)
  }

  endOfTurn(): RealizedTurn | null {
    if (this.phase === 'speaking') return null
    const plan = this.ports.brain.plan()
    const realized = this.ports.mouth.realize(plan)
    this.phase = 'speaking'
    this.gate.onTtsStart()
    const lines = realized.map((d) => this.ports.phraser.phrase(d.intent))
    for (const line of lines) this.ports.tts.speak(line)
    const marker = this.ports.tts.finish()
    this.pendingMarker = marker
    const turn: RealizedTurn = { index: this.turnSeq++, plan, realized, lines, marker }
    this.log.push(turn)
    return turn
  }

  ttsEnded(markerId: number): void {
    if (this.phase !== 'speaking' || markerId !== this.pendingMarker) return
    this.gate.onTtsEnd(this.now())
    this.pendingMarker = null
    this.phase = 'listening'
  }

  reset(): void {
    this.phase = 'listening'
    this.pendingMarker = null
    this.gate.reset()
    this.log.length = 0
  }
}
