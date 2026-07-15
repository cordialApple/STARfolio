import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { storeAttachment } from '../../src/main/ingest/attachments'

let userData: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'starfolio-att-'))
  vi.spyOn(app, 'getPath').mockReturnValue(userData)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(userData, { recursive: true, force: true })
})

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('storeAttachment', () => {
  it('addresses content by hash independent of the original name', () => {
    const a = storeAttachment(bytes('hello'), 'a.pdf')
    const b = storeAttachment(bytes('hello'), 'renamed.pdf')
    expect(a.hash).toBe(b.hash)
    expect(a.attachmentPath).toBe(b.attachmentPath)
  })

  it('gives distinct content distinct hashes', () => {
    const a = storeAttachment(bytes('hello'), 'x.txt')
    const b = storeAttachment(bytes('world'), 'x.txt')
    expect(a.hash).not.toBe(b.hash)
  })

  it('lowercases the extension and keeps it in the path', () => {
    const { hash, attachmentPath } = storeAttachment(bytes('doc'), 'Report.PDF')
    expect(attachmentPath).toBe(join(userData, 'attachments', `${hash}.pdf`))
  })

  it('drops the dot when the name has no extension', () => {
    const { hash, attachmentPath } = storeAttachment(bytes('raw'), 'noext')
    expect(attachmentPath).toBe(join(userData, 'attachments', hash))
  })

  it('writes the bytes and dedupes a second store of the same content', () => {
    const first = storeAttachment(bytes('payload'), 'p.bin')
    expect(existsSync(first.attachmentPath)).toBe(true)
    expect(readFileSync(first.attachmentPath).toString()).toBe('payload')
    const second = storeAttachment(bytes('payload'), 'p.bin')
    expect(second.attachmentPath).toBe(first.attachmentPath)
  })
})
