import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import { createSource, findSourceByHash, getSource } from '../../src/main/db/repositories/sources'
import { createExperience } from '../../src/main/db/repositories/experiences'

describe('sources repository', () => {
  beforeEach(() => initDb(':memory:'))

  it('persists a file source with attachment path and meta', () => {
    const s = createSource({
      kind: 'file',
      uri_or_path: 'C:/docs/resume.pdf',
      attachment_path: 'C:/userData/attachments/abc.pdf',
      title: 'resume.pdf',
      raw_text: 'led the migration',
      content_hash: 'abc',
      meta: { kind: 'pdf', numPages: 1 }
    })
    expect(s.kind).toBe('file')
    expect(s.attachment_path).toBe('C:/userData/attachments/abc.pdf')
    expect(getSource(s.id)?.uri_or_path).toBe('C:/docs/resume.pdf')
  })

  it('dedups by content hash', () => {
    const s = createSource({ kind: 'file', raw_text: 'x', content_hash: 'deadbeef' })
    expect(findSourceByHash('deadbeef')?.id).toBe(s.id)
    expect(findSourceByHash('nope')).toBeNull()
  })

  it('links one source to several experiences (resume splitting) without duplicating the row', () => {
    const src = createSource({ kind: 'file', raw_text: 'a resume', content_hash: 'h1', title: 'cv.pdf' })
    const a = createExperience({ title: 'Role A', action: 'did A', source_id: src.id })
    const b = createExperience({ title: 'Role B', action: 'did B', source_id: src.id })

    expect(a.sources.map((s) => s.id)).toEqual([src.id])
    expect(b.sources.map((s) => s.id)).toEqual([src.id])
    const count = (getDb().prepare('SELECT COUNT(*) c FROM sources').get() as { c: number }).c
    expect(count).toBe(1)
  })

  it('still creates an inline source when no source_id is given', () => {
    const exp = createExperience({
      title: 'Pasted',
      action: 'notes',
      source: { kind: 'paste', raw_text: 'some pasted notes' }
    })
    expect(exp.sources).toHaveLength(1)
    expect(exp.sources[0].kind).toBe('paste')
  })
})
