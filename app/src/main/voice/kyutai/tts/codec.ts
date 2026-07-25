import { decode, encode } from '@msgpack/msgpack'
import type { TtsInMsg, TtsOutMsg } from './protocol'

export const TTS_OUT_TYPES = new Set(['Ready', 'Audio', 'Marker', 'Error'])

export function encodeTtsIn(msg: TtsInMsg): Uint8Array {
  return encode(msg)
}

export function decodeTtsOut(bytes: Uint8Array): TtsOutMsg {
  const value = decode(bytes)
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('kyutai-tts: malformed frame (no type)')
  }
  const type = (value as { type: unknown }).type
  if (typeof type !== 'string' || !TTS_OUT_TYPES.has(type)) {
    throw new Error(`kyutai-tts: unknown out type ${String(type)}`)
  }
  return value as TtsOutMsg
}
