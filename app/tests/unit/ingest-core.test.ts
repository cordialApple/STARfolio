import { describe, it, expect, vi } from 'vitest'
import {
  buildFileSource,
  ingestCodeFolder,
  ingestRepo,
  ingestUrl,
  replyPayload,
  type IngestDeps,
  type SourceStore
} from '../../src/main/ingest/core'
import type { Source } from '../../src/main/db/repositories/sources'

function sourceOf(over: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    kind: 'file',
    title: null,
    raw_text: null,
    uri_or_path: null,
    attachment_path: null,
    ingested_at: '2026-01-01',
    ...over
  }
}

function makeDeps(over: { store?: Partial<SourceStore>; parsers?: Partial<IngestDeps['parsers']> } = {}): {
  deps: IngestDeps
  created: unknown[]
} {
  const created: unknown[] = []
  const store: SourceStore = {
    createSource: vi.fn((input: unknown) => {
      created.push(input)
      return sourceOf({ id: `src-${created.length}` })
    }),
    findSourceByHash: vi.fn(() => null),
    sha256: vi.fn((text: string) => `hash-${text}`),
    ...over.store
  }
  const parsers: IngestDeps['parsers'] = {
    parseDocument: vi.fn(async () => ({ text: 'body', scanned: false, meta: {} })),
    parseUrlDocument: vi.fn(async () => ({ text: 'article', title: 'T', finalUrl: 'https://x/', meta: {} })),
    parseSheetDocument: vi.fn(async () => ({ text: 'rows', title: null, meta: {} })),
    packZipDocument: vi.fn(async () => ({ text: 'zip', title: null, meta: {} })),
    packFolderDocument: vi.fn(async () => ({ text: 'folder', title: null, meta: {} })),
    packRepoDocument: vi.fn(async () => ({ text: 'repo', title: 'Repo', meta: {} })),
    ...over.parsers
  }
  return { deps: { store, parsers }, created }
}

const FILE = { path: '/p/a.pdf', name: 'a.pdf', bytes: new Uint8Array([1]), hash: 'h', attachmentPath: '/att/h.pdf' }

describe('buildFileSource', () => {
  it('returns the existing source as a duplicate without parsing', async () => {
    const existing = sourceOf({ id: 'dupe' })
    const { deps } = makeDeps({ store: { findSourceByHash: () => existing } })
    const r = await buildFileSource(deps, FILE)
    expect(r).toEqual({ ok: true, name: 'a.pdf', duplicate: true, source: existing })
    expect(deps.parsers.parseDocument).not.toHaveBeenCalled()
  })

  it('routes .xlsx to the sheet parser as a spreadsheet source', async () => {
    const { deps, created } = makeDeps()
    const r = await buildFileSource(deps, { ...FILE, name: 'sheet.xlsx' })
    expect(r.ok).toBe(true)
    expect(deps.parsers.parseSheetDocument).toHaveBeenCalled()
    expect((created[0] as { kind: string }).kind).toBe('spreadsheet')
  })

  it('routes .zip to the zip packer as a code source', async () => {
    const { deps, created } = makeDeps()
    const r = await buildFileSource(deps, { ...FILE, name: 'proj.zip' })
    expect(r.ok).toBe(true)
    expect(deps.parsers.packZipDocument).toHaveBeenCalled()
    expect((created[0] as { kind: string }).kind).toBe('code')
  })

  it('rejects a scanned PDF with the no-text-layer message', async () => {
    const { deps } = makeDeps({ parsers: { parseDocument: async () => ({ text: '', scanned: true, meta: {} }) } })
    expect(await buildFileSource(deps, FILE)).toEqual({
      ok: false,
      name: 'a.pdf',
      scanned: true,
      error: 'This PDF looks scanned — there is no text layer to read.'
    })
  })

  it('rejects an empty document with the no-readable-text message', async () => {
    const { deps } = makeDeps({ parsers: { parseDocument: async () => ({ text: '   ', scanned: false, meta: {} }) } })
    expect(await buildFileSource(deps, FILE)).toEqual({
      ok: false,
      name: 'a.pdf',
      error: 'No readable text found in this file.'
    })
  })

  it('creates a file source for a readable document', async () => {
    const { deps, created } = makeDeps()
    const r = await buildFileSource(deps, FILE)
    expect(r.ok).toBe(true)
    expect(created[0]).toMatchObject({ kind: 'file', uri_or_path: '/p/a.pdf', content_hash: 'h', raw_text: 'body' })
  })
})

describe('ingestUrl', () => {
  it('rejects a page with no readable article', async () => {
    const { deps } = makeDeps({ parsers: { parseUrlDocument: async () => ({ text: '', title: null, finalUrl: 'https://x/', meta: {} }) } })
    expect(await ingestUrl(deps, 'https://x')).toEqual({
      ok: false,
      name: 'https://x',
      error: 'No readable article found on that page.'
    })
  })

  it('hashes finalUrl + text and creates a url source', async () => {
    const { deps, created } = makeDeps()
    const r = await ingestUrl(deps, 'https://x')
    expect(r.ok).toBe(true)
    expect(deps.store.sha256).toHaveBeenCalledWith('https://x/\narticle')
    expect(created[0]).toMatchObject({ kind: 'url', uri_or_path: 'https://x/' })
  })

  it('returns the parser error message on failure', async () => {
    const { deps } = makeDeps({ parsers: { parseUrlDocument: async () => { throw new Error('boom') } } })
    expect(await ingestUrl(deps, 'https://x')).toEqual({ ok: false, name: 'https://x', error: 'boom' })
  })
})

describe('ingestCodeFolder and ingestRepo', () => {
  it('creates a code source from a folder', async () => {
    const { deps, created } = makeDeps()
    const r = await ingestCodeFolder(deps, '/repo/proj')
    expect(r).toMatchObject({ ok: true, name: 'proj' })
    expect(created[0]).toMatchObject({ kind: 'code', uri_or_path: '/repo/proj' })
  })

  it('dedupes a repo by content hash', async () => {
    const existing = sourceOf({ id: 'dupe' })
    const { deps } = makeDeps({ store: { findSourceByHash: () => existing } })
    expect(await ingestRepo(deps, 'https://gh/r')).toEqual({ ok: true, name: 'Repo', duplicate: true, source: existing })
  })

  it('reports the repo name as the url on failure', async () => {
    const { deps } = makeDeps({ parsers: { packRepoDocument: async () => { throw new Error('nope') } } })
    expect(await ingestRepo(deps, 'https://gh/r')).toEqual({ ok: false, name: 'https://gh/r', error: 'nope' })
  })
})

describe('replyPayload', () => {
  it('returns the populated arm', () => {
    const doc = { text: 'd', scanned: false, meta: {} }
    expect(replyPayload({ doc })).toBe(doc)
    const pack = { text: 'p', title: null, meta: {} }
    expect(replyPayload({ pack })).toBe(pack)
  })

  it('throws when no arm is present', () => {
    expect(() => replyPayload({})).toThrow('ingest worker returned an empty reply')
  })
})
