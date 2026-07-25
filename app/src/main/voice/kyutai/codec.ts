import { decode, encode } from '@msgpack/msgpack'
import type { InMsg, OutMsg } from './protocol'

const OUT_TYPES = new Set(['Ready', 'Word', 'EndWord', 'Step', 'Marker', 'Error'])

export function encodeInMsg(msg: InMsg): Uint8Array {
  return encode(msg, { forceFloat32: true })
}

export function decodeOutMsg(bytes: Uint8Array): OutMsg {
  const value = decode(bytes)
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('kyutai: malformed frame (no type)')
  }
  const type = (value as { type: unknown }).type
  if (typeof type !== 'string' || !OUT_TYPES.has(type)) {
    throw new Error(`kyutai: unknown out type ${String(type)}`)
  }
  return value as OutMsg
}
