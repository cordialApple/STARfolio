import type { AnswerEvaluation } from '../roadmap'

export interface SteeringView {
  text: string
}

export interface SteeringSignal {
  at: number
  text: string
  evaluation: AnswerEvaluation
}

export interface SteeringLoopDeps {
  view: () => SteeringView
  evaluate: (text: string) => Promise<AnswerEvaluation>
}

export class SteeringLoop {
  private signal: SteeringSignal | null = null
  private startedGen = 0
  private committedGen = 0
  private lastStartedText: string | null = null

  constructor(private readonly deps: SteeringLoopDeps) {}

  latest(): SteeringSignal | null {
    return this.signal
  }

  async run(now: number): Promise<SteeringSignal | null> {
    const text = this.deps.view().text.trim()
    if (!text || text === this.lastStartedText) return this.signal
    this.lastStartedText = text
    const gen = ++this.startedGen
    const evaluation = await this.deps.evaluate(text)
    if (gen > this.committedGen) {
      this.committedGen = gen
      this.signal = { at: now, text, evaluation }
    }
    return this.signal
  }

  reset(): void {
    this.signal = null
    this.startedGen = 0
    this.committedGen = 0
    this.lastStartedText = null
  }
}
