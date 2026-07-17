import type { UtterancePartial } from './stream'

export function partialToDelta(
  emitToken: (delta: string) => void,
  emitDone: () => void
): (partial: UtterancePartial) => void {
  let sent = 0
  return (partial) => {
    const delta = partial.text.slice(sent)
    if (delta) {
      emitToken(delta)
      sent = partial.text.length
    }
    if (partial.done) emitDone()
  }
}
