import type { PartialTranscript } from './types'

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function normalize(token: string): string {
  return token.toLowerCase().replace(/[.,!?;:"']+$/g, '')
}

function agreedPrefixLen(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && normalize(a[i]) === normalize(b[i])) i++
  return i
}

// LocalAgreement-2: whisper re-decodes a growing window each tick, so its hypothesis is unstable
// at the tail. A token is only committed once two consecutive hypotheses agree on it; the committed
// prefix never shrinks, which is what lets the UI freeze stable text and re-flow only the tail.
export class LocalAgreement {
  private committed: string[] = []
  private previous: string[] = []

  update(hypothesis: string): PartialTranscript {
    const words = tokenize(hypothesis)
    const agreed = agreedPrefixLen(this.previous, words)
    if (agreed > this.committed.length) this.committed = words.slice(0, agreed)
    this.previous = words
    return this.toPartial(words)
  }

  finalize(hypothesis?: string): PartialTranscript {
    const words = hypothesis === undefined ? this.previous : tokenize(hypothesis)
    this.committed = words
    this.previous = words
    return this.toPartial(words)
  }

  reset(): void {
    this.committed = []
    this.previous = []
  }

  private toPartial(words: string[]): PartialTranscript {
    const stableText = this.committed.join(' ')
    const tail = words.slice(this.committed.length).join(' ')
    const text = [stableText, tail].filter(Boolean).join(' ')
    return { text, stableUpTo: stableText.length }
  }
}
