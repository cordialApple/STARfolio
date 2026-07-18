export function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  if (name === 'NotAllowedError') {
    return 'Microphone access was blocked. Enable it in Windows Settings › Privacy › Microphone, then retry.'
  }
  return `Could not start listening: ${message.trim() || 'unknown error'}`
}
