import { describe, it, expect } from 'vitest'
import {
  experienceToMarkdown,
  parseMarkdown,
  slugFor,
  type VaultExperience
} from '../../src/main/vault/markdown'
import { exportVault, readVault, removeNote, type VaultFs } from '../../src/main/vault/sync'

function sample(over: Partial<VaultExperience> = {}): VaultExperience {
  return {
    id: 'abcd1234-0000-0000-0000-000000000000',
    title: 'Cut deploy time 40%',
    situation: 'Deploys took an hour.',
    task: 'Make them fast.',
    action: 'Parallelized the pipeline.',
    result_text: 'Down to 36 minutes.',
    context: 'work',
    happened_start: '2024-01-01',
    happened_end: '2024-03-01',
    status: 'confirmed',
    skills: [
      { name: 'Kubernetes', kind: 'technical' },
      { name: 'Teamwork', kind: 'soft' }
    ],
    tags: ['devops', 'ci/cd'],
    metrics: [
      { label: 'Deploy time', value: 40, unit: '%' },
      { label: 'Note', value: null, unit: 'qualitative' }
    ],
    ...over
  }
}

function fields(e: VaultExperience): Omit<VaultExperience, 'id' | 'created_at' | 'updated_at'> {
  const { id, created_at, updated_at, ...rest } = e
  return rest
}

describe('vault markdown round-trip', () => {
  it('preserves every field through serialize → parse', () => {
    const exp = sample()
    const parsed = parseMarkdown(experienceToMarkdown(exp))
    expect(parsed.id).toBe(exp.id)
    expect(fields(exp)).toEqual({
      title: parsed.title,
      situation: parsed.situation,
      task: parsed.task,
      action: parsed.action,
      result_text: parsed.result_text,
      context: parsed.context,
      happened_start: parsed.happened_start,
      happened_end: parsed.happened_end,
      status: parsed.status,
      skills: parsed.skills,
      tags: parsed.tags,
      metrics: parsed.metrics
    })
  })

  it('survives titles and tags with commas, quotes, and brackets', () => {
    const exp = sample({ title: 'Fixed "the [big] bug", fast', tags: ['a, b', 'c]d'] })
    const parsed = parseMarkdown(experienceToMarkdown(exp))
    expect(parsed.title).toBe(exp.title)
    expect(parsed.tags).toEqual(exp.tags)
  })

  it('handles empty sections and no metrics', () => {
    const exp = sample({
      situation: '',
      task: '',
      action: '',
      result_text: '',
      skills: [],
      tags: [],
      metrics: []
    })
    const parsed = parseMarkdown(experienceToMarkdown(exp))
    expect(parsed.situation).toBe('')
    expect(parsed.skills).toEqual([])
    expect(parsed.metrics).toEqual([])
  })

  it('defaults kind to technical for a plain skill name a user typed', () => {
    const md = ['---', 'id: x', 'title: "t"', 'skills: ["Rust"]', 'tags: []', '---', '## Situation', 'x'].join(
      '\n'
    )
    expect(parseMarkdown(md).skills).toEqual([{ name: 'Rust', kind: 'technical' }])
  })

  it('slug is filesystem-safe and carries an id suffix', () => {
    expect(slugFor({ id: 'abcd1234-ef', title: 'Cut deploy time 40%!' })).toBe('cut-deploy-time-40-abcd1234.md')
    expect(slugFor({ id: 'zzzz9999-00', title: '' })).toBe('note-zzzz9999.md')
  })
})

describe('parseMarkdown — real Obsidian notes', () => {
  it('reads a title from the H1 when frontmatter has none', () => {
    const n = parseMarkdown('# Led the migration\n\nMoved 200 services to k8s.')
    expect(n.id).toBeNull()
    expect(n.title).toBe('Led the migration')
  })

  it('prefers a frontmatter title over the H1', () => {
    expect(parseMarkdown('---\ntitle: "FM"\n---\n\n# H1\n\nbody').title).toBe('FM')
  })

  it('parses skills and metrics written as YAML block lists, ignoring unknown keys', () => {
    const md = [
      '---',
      'id: 2025-tiger-racing-postgres-rls-cicd',
      'title: "built the Formula SAE database with RLS and CI/CD"',
      'context: project',
      'status: draft',
      'confidence:',
      '  situation: high',
      '  result: medium',
      'skills:',
      '  - name: "PostgreSQL"',
      '    kind: "technical"',
      '  - name: "Row-Level Security"',
      '    kind: "technical"',
      'tags: ["tiger-racing", "postgres"]',
      'metrics:',
      '  - label: "tables"',
      '    value: 10',
      '    unit: "tables (10+)"',
      'entities: ["[[LSU Formula SAE]]"]',
      '---',
      '',
      '## Situation',
      'team data needed per-user isolation.',
      '',
      '## Result',
      'per-user isolation enforced by the database.',
      '',
      '## Gaps',
      '- [ ] confirm scope'
    ].join('\n')
    const n = parseMarkdown(md)
    expect(n.id).toBe('2025-tiger-racing-postgres-rls-cicd')
    expect(n.title).toBe('built the Formula SAE database with RLS and CI/CD')
    expect(n.context).toBe('project')
    expect(n.situation).toBe('team data needed per-user isolation.')
    expect(n.result_text).toBe('per-user isolation enforced by the database.')
    expect(n.skills).toEqual([
      { name: 'PostgreSQL', kind: 'technical' },
      { name: 'Row-Level Security', kind: 'technical' }
    ])
    expect(n.tags).toEqual(['tiger-racing', 'postgres'])
    expect(n.metrics).toEqual([{ label: 'tables', value: 10, unit: 'tables (10+)' }])
  })
})

function memFs(): { fs: VaultFs; store: Map<string, string> } {
  const store = new Map<string, string>()
  const fs: VaultFs = {
    join: (...p) => p.join('/'),
    mkdir: async () => {},
    writeFile: async (path, data) => {
      store.set(path, data)
    },
    readFile: async (path) => {
      const v = store.get(path)
      if (v == null) throw new Error(`missing ${path}`)
      return v
    },
    walk: async (dir) =>
      [...store.keys()]
        .filter((k) => k.startsWith(`${dir}/`))
        .map((k) => k.slice(dir.length + 1))
        .filter((p) => !p.split('/').some((s) => s.startsWith('.'))),
    unlink: async (path) => {
      if (!store.delete(path)) throw new Error(`missing ${path}`)
    }
  }
  return { fs, store }
}

describe('vault sync', () => {
  it('exports one .md per experience and reads them back', async () => {
    const { fs } = memFs()
    const a = sample({ id: 'aaaa1111-x', title: 'First' })
    const b = sample({ id: 'bbbb2222-x', title: 'Second' })
    const { written } = await exportVault(fs, '/vault', [a, b])
    expect(written).toBe(2)
    const notes = await readVault(fs, '/vault')
    expect(notes.map((n) => n.title).sort()).toEqual(['First', 'Second'])
  })

  it('removeNote deletes the matching file and ignores a missing one', async () => {
    const { fs, store } = memFs()
    const a = sample({ id: 'aaaa1111-x', title: 'First' })
    await exportVault(fs, '/vault', [a])
    expect(store.size).toBe(1)
    await removeNote(fs, '/vault', a)
    expect(store.size).toBe(0)
    await expect(removeNote(fs, '/vault', a)).resolves.toBeUndefined()
  })

  it('reads notes from subfolders and skips dotfolders like .obsidian', async () => {
    const { fs, store } = memFs()
    store.set(
      '/vault/experiences/2026-07-12-win.md',
      '---\nid: x1\ntitle: "A real win"\n---\n\n## Situation\nsomething happened.'
    )
    store.set('/vault/.obsidian/workspace.json', '{}')
    const notes = await readVault(fs, '/vault')
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('A real win')
    expect(notes[0].situation).toBe('something happened.')
  })
})
