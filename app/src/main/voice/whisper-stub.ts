export function isWhisperStub(): boolean {
  return process.env.STARFOLIO_WHISPER_STUB === '1'
}
