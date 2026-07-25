export type Speaker = 'interviewer' | 'candidate'

export interface TranscriptEntry {
  speaker: Speaker
  text: string
  startMs: number
  endMs: number
  truncated: boolean
}

export type EntryInput = {
  speaker: Speaker
  text: string
  startMs: number
  endMs: number
  truncated?: boolean
}

const SPEAKER_LABEL: Record<Speaker, string> = {
  interviewer: 'Interviewer',
  candidate: 'Candidate'
}

function crosses(a: TranscriptEntry, b: TranscriptEntry): boolean {
  return a.speaker !== b.speaker && a.startMs < b.endMs && b.startMs < a.endMs
}

export class CanonicalTranscript {
  private entries: TranscriptEntry[] = []

  append(input: EntryInput): TranscriptEntry {
    if (input.endMs < input.startMs) {
      throw new Error(`transcript: entry ends (${input.endMs}) before it starts (${input.startMs})`)
    }
    const entry: TranscriptEntry = {
      speaker: input.speaker,
      text: input.text.trim(),
      startMs: input.startMs,
      endMs: input.endMs,
      truncated: input.truncated ?? false
    }
    const at = this.insertionIndex(entry.startMs)
    this.entries.splice(at, 0, entry)
    return entry
  }

  private insertionIndex(startMs: number): number {
    let i = this.entries.length
    while (i > 0 && this.entries[i - 1].startMs > startMs) i--
    return i
  }

  reset(): void {
    this.entries = []
  }

  get length(): number {
    return this.entries.length
  }

  all(): readonly TranscriptEntry[] {
    return this.entries
  }

  private *crossingPairs(): Generator<[TranscriptEntry, TranscriptEntry]> {
    for (let i = 0; i < this.entries.length; i++) {
      for (let j = i + 1; j < this.entries.length; j++) {
        if (crosses(this.entries[i], this.entries[j])) yield [this.entries[i], this.entries[j]]
      }
    }
  }

  overlaps(): Array<[TranscriptEntry, TranscriptEntry]> {
    return [...this.crossingPairs()]
  }

  hasOverlap(): boolean {
    return !this.crossingPairs().next().done
  }

  private overlapsAny(entry: TranscriptEntry): boolean {
    return this.entries.some((other) => other !== entry && crosses(entry, other))
  }

  render(): string {
    return this.entries
      .map((e) => {
        const label = this.overlapsAny(e) ? `${SPEAKER_LABEL[e.speaker]} (overlapping)` : SPEAKER_LABEL[e.speaker]
        const text = e.truncated ? `${e.text} [cut off]` : e.text
        return `${label}: ${text}`
      })
      .join('\n')
  }
}
