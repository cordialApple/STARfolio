import { describe, it, expect, vi } from 'vitest'
import {
  ingestCorpusFile,
  ingestCorpusUrl,
  type CorpusDeps,
  type CorpusStore
} from '../../src/main/ingest/corpus-core'
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

function makeDeps(over: { store?: Partial<CorpusStore>; parsers?: Partial<CorpusDeps['parsers']> } = {}): {
  deps: CorpusDeps
  persistArgs: unknown[][]
} {
  const persistArgs: unknown[][] = []
  const store: CorpusStore = {
    createSource: vi.fn(() => sourceOf()),
    chunkText: vi.fn((text: string) => (text.trim() ? ['c1', 'c2'] : [])),
    persistDoc: vi.fn((title, discipline, sourceId, chunks) => {
      persistArgs.push([title, discipline, sourceId, chunks])
      return { docId: 'doc-1', chunkIds: ['ck1', 'ck2'] }
    }),
    enqueueEmbed: vi.fn(),
    kickDrain: vi.fn(),
    ...over.store
  }
  const parsers: CorpusDeps['parsers'] = {
    parseDocument: vi.fn(async () => ({ text: 'body', scanned: false, meta: {} })),
    parseUrlDocument: vi.fn(async () => ({ text: 'article', title: 'T', finalUrl: 'https://x/', meta: {} })),
    ...over.parsers
  }
  return { deps: { store, parsers }, persistArgs }
}

const FILE = { path: '/p/a.pdf', name: 'a.pdf', bytes: new Uint8Array([1]) }

describe('ingestCorpusFile', () => {
  it('rejects a scanned PDF', async () => {
    const { deps } = makeDeps({ parsers: { parseDocument: async () => ({ text: '', scanned: true, meta: {} }) } })
    expect(await ingestCorpusFile(deps, FILE, 'eng')).toEqual({
      ok: false,
      name: 'a.pdf',
      error: 'This PDF looks scanned — there is no text layer to read.'
    })
  })

  it('rejects an empty document', async () => {
    const { deps } = makeDeps({ parsers: { parseDocument: async () => ({ text: '  ', scanned: false, meta: {} }) } })
    expect(await ingestCorpusFile(deps, FILE, 'eng')).toEqual({
      ok: false,
      name: 'a.pdf',
      error: 'No readable text found in this file.'
    })
  })

  it('rejects when chunking yields nothing', async () => {
    const { deps } = makeDeps({ store: { chunkText: () => [] } })
    expect(await ingestCorpusFile(deps, FILE, 'eng')).toEqual({
      ok: false,
      name: 'a.pdf',
      error: 'No readable text to add to the corpus.'
    })
  })

  it('persists, enqueues every chunk, kicks the drain, and trims the discipline', async () => {
    const { deps, persistArgs } = makeDeps()
    const r = await ingestCorpusFile(deps, FILE, '  eng  ')
    expect(r).toEqual({ ok: true, name: 'a.pdf', docId: 'doc-1', chunks: 2 })
    expect(persistArgs[0]).toEqual(['a.pdf', 'eng', 'src-1', ['c1', 'c2']])
    expect(deps.store.enqueueEmbed).toHaveBeenCalledTimes(2)
    expect(deps.store.kickDrain).toHaveBeenCalledOnce()
  })

  it('maps a blank discipline to null', async () => {
    const { deps, persistArgs } = makeDeps()
    await ingestCorpusFile(deps, FILE, '   ')
    expect(persistArgs[0][1]).toBeNull()
  })
})

describe('ingestCorpusUrl', () => {
  it('rejects a page with no readable article', async () => {
    const { deps } = makeDeps({ parsers: { parseUrlDocument: async () => ({ text: '', title: null, finalUrl: 'https://x/', meta: {} }) } })
    expect(await ingestCorpusUrl(deps, 'https://x', 'eng')).toEqual({
      ok: false,
      name: 'https://x',
      error: 'No readable article found on that page.'
    })
  })

  it('persists the article under its title', async () => {
    const { deps, persistArgs } = makeDeps()
    const r = await ingestCorpusUrl(deps, 'https://x', 'eng')
    expect(r).toMatchObject({ ok: true, name: 'T', docId: 'doc-1', chunks: 2 })
    expect(persistArgs[0][0]).toBe('T')
  })

  it('falls back to the url as the name when the title is null', async () => {
    const { deps } = makeDeps({ parsers: { parseUrlDocument: async () => ({ text: 'a', title: null, finalUrl: 'https://x/', meta: {} }) } })
    const r = await ingestCorpusUrl(deps, 'https://x', 'eng')
    expect(r.name).toBe('https://x')
  })

  it('returns the parser error message on failure', async () => {
    const { deps } = makeDeps({ parsers: { parseUrlDocument: async () => { throw new Error('down') } } })
    expect(await ingestCorpusUrl(deps, 'https://x', 'eng')).toEqual({ ok: false, name: 'https://x', error: 'down' })
  })
})
