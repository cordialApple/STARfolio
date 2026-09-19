export function shouldCaptureDemoAudio(mode: unknown, consent: unknown): boolean {
  if (consent !== true) throw new Error('Consent required before starting demo')
  if (mode === 'fixture') return false
  if (mode === 'moshi') return true
  throw new Error('Unknown gateway mode')
}
