import { describe, expect, it } from 'vitest'
import { decodeText } from '../../src/main/ingest/extractors'

const enc = new TextEncoder()

describe('decodeText', () => {
  it('returns utf-8 text unchanged when no leading BOM survives decoding', () => {
    expect(decodeText(enc.encode('hello world'))).toBe('hello world')
  })

  it('strips a leading U+FEFF byte-order mark from the decoded text', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const bytes = new Uint8Array([...bom, ...bom, ...enc.encode('body')])
    expect(decodeText(bytes)).toBe('body')
  })
})
