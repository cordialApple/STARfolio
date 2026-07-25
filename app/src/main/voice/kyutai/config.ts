export const KYUTAI_STT = {
  url: 'ws://127.0.0.1:8080/api/asr-streaming',
  apiKey: 'public_token',
  model: 'stt-1b-en_fr'
} as const

export function isKyutaiStub(): boolean {
  return process.env.STARFOLIO_KYUTAI_STUB === '1'
}

export function kyutaiEndpoint(): string {
  return process.env.STARFOLIO_KYUTAI_URL ?? KYUTAI_STT.url
}

export function kyutaiApiKey(): string {
  return process.env.STARFOLIO_KYUTAI_KEY ?? KYUTAI_STT.apiKey
}
