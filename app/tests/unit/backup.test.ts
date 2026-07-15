import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { exportBank, importBank } from '../../src/main/db/backup'
import { createExperience, getExperience } from '../../src/main/db/repositories/experiences'

const fullExperience = {
  title: 'Shipped the thing',
  situation: 'legacy service was slow',
  task: 'make it fast',
  action: 'added a cache',
  result_text: 'p99 dropped 40%',
  context: 'work' as const,
  status: 'confirmed' as const,
  skills: [
    { name: 'redis', kind: 'technical' as const },
    { name: 'ownership', kind: 'soft' as const }
  ],
  tags: ['performance', 'backend'],
  metrics: [{ label: 'p99 latency', value: 40, unit: '%' }]
}

beforeEach(() => {
  initDb(':memory:')
})

describe('importBank', () => {
  it('rejects non-object input', () => {
    expect(() => importBank(null)).toThrow()
    expect(() => importBank(42)).toThrow()
  })

  it('rejects an experience with the wrong shape', () => {
    expect(() => importBank({ experiences: [{ status: 'not-a-status' }] })).toThrow()
    expect(() => importBank({ experiences: [{ skills: [{ kind: 'technical' }] }] })).toThrow()
  })

  it('imports nothing when experiences is omitted', () => {
    expect(importBank({})).toEqual({ imported: 0, ids: [] })
  })
})

describe('exportBank', () => {
  it('stamps the current export version', () => {
    createExperience({ title: 'x', sources: undefined })
    expect(exportBank().version).toBe(1)
  })

  it('round-trips an experience through export then import', () => {
    createExperience(fullExperience)
    const dump = exportBank()
    expect(dump.experiences).toHaveLength(1)

    initDb(':memory:')
    const { imported, ids } = importBank(dump)
    expect(imported).toBe(1)

    const e = getExperience(ids[0])!
    expect(e.title).toBe('Shipped the thing')
    expect(e.result_text).toBe('p99 dropped 40%')
    expect(e.context).toBe('work')
    expect(e.status).toBe('confirmed')
    expect(e.skills.map((s) => s.name).sort()).toEqual(['ownership', 'redis'])
    expect(e.tags.map((t) => t.name).sort()).toEqual(['backend', 'performance'])
    expect(e.metrics).toHaveLength(1)
    expect(e.metrics[0]).toMatchObject({ label: 'p99 latency', value: 40, unit: '%' })
  })

  it('links every source, not just the first', () => {
    const { ids } = importBank({
      experiences: [
        {
          title: 'multi',
          sources: [
            { kind: 'paste', raw_text: 'first note' },
            { kind: 'url', raw_text: '', uri_or_path: 'https://example.com' }
          ]
        }
      ]
    })
    const dump = exportBank()
    expect(dump.experiences[0].sources).toHaveLength(2)
    expect(getExperience(ids[0])!.sources).toHaveLength(2)
  })
})
