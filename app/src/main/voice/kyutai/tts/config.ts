export const KYUTAI_TTS = {
  url: 'ws://127.0.0.1:8089/api/tts-streaming',
  apiKey: 'public_token'
} as const

export function isKyutaiTtsStub(): boolean {
  return process.env.STARFOLIO_KYUTAI_TTS_STUB === '1'
}

export function kyutaiTtsEndpoint(): string {
  return process.env.STARFOLIO_KYUTAI_TTS_URL ?? KYUTAI_TTS.url
}

export function kyutaiTtsApiKey(): string {
  return process.env.STARFOLIO_KYUTAI_TTS_KEY ?? KYUTAI_TTS.apiKey
}
