import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { deflateRawSync } from 'zlib'
import {
  sheetToText,
  packFolder,
  packZipBytes,
  parseGitHubUrl,
  ghHeaders
} from '../../src/main/ingest/evidence-extractors'

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function makeZip(entries: { name: string; data: string }[]): Uint8Array {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const raw = Buffer.from(e.data, 'utf8')
    const comp = deflateRawSync(raw)
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    chunks.push(local, nameBuf, comp)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += local.length + nameBuf.length + comp.length
  }
  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...chunks, cdBuf, end]))
}

describe('sheetToText', () => {
  it('flattens a csv with a numeric summary', async () => {
    const csv = 'month,revenue\nJan,100\nFeb,250\nMar,400'
    const text = await sheetToText('q1.csv', new TextEncoder().encode(csv))
    expect(text).toContain('revenue')
    expect(text).toContain('Feb\t250')
    expect(text).toMatch(/revenue: count=3 min=100 max=400 sum=750/)
  })

  it('reads an xlsx workbook into per-sheet text', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Metrics')
    ws.addRow(['task', 'hours'])
    ws.addRow(['migration', 40])
    ws.addRow(['cleanup', 12])
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
    const text = await sheetToText('m.xlsx', new Uint8Array(buf))
    expect(text).toContain('Sheet: Metrics')
    expect(text).toContain('migration')
    expect(text).toMatch(/hours: count=2 min=12 max=40 sum=52/)
  })
})

describe('packFolder', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'pack-'))
    writeFileSync(join(root, '.gitignore'), 'secret.txt\n')
    writeFileSync(join(root, 'README.md'), '# Cool Project\nBuilt with TypeScript and Postgres.')
    writeFileSync(join(root, 'index.ts'), 'export const x = 1')
    writeFileSync(join(root, 'secret.txt'), 'SUPER_SECRET_TOKEN')
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = 1')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('packs text files, applies .gitignore, and skips node_modules', async () => {
    const { text, tree, languages } = await packFolder(root)
    expect(tree).toContain('README.md')
    expect(tree).toContain('index.ts')
    expect(text).toContain('Built with TypeScript')
    expect(languages['.ts']).toBe(1)
    expect(text).not.toContain('SUPER_SECRET_TOKEN')
    expect(text).not.toContain('node_modules')
  })

  it('honors a nested .gitignore scoped to its own subtree', async () => {
    const nest = mkdtempSync(join(tmpdir(), 'pack-nest-'))
    mkdirSync(join(nest, 'sub'), { recursive: true })
    writeFileSync(join(nest, 'sub', '.gitignore'), 'local.log\n')
    writeFileSync(join(nest, 'sub', 'local.log'), 'NESTED_IGNORED')
    writeFileSync(join(nest, 'sub', 'keep.ts'), 'export const y = 2')
    writeFileSync(join(nest, 'local.log'), 'ROOT_KEPT')
    try {
      const { text, tree } = await packFolder(nest)
      expect(text).not.toContain('NESTED_IGNORED')
      expect(tree).toContain('keep.ts')
      expect(text).toContain('ROOT_KEPT')
    } finally {
      rmSync(nest, { recursive: true, force: true })
    }
  })

  it('normalizes a non-canonical root path', async () => {
    const { tree } = await packFolder(join(root, 'sub', '..'))
    expect(tree).toContain('index.ts')
  })
})

describe('ghHeaders', () => {
  it('sends the GitHub bearer token only when one is provided', () => {
    expect(ghHeaders('ghp_secret').Authorization).toBe('Bearer ghp_secret')
    expect(ghHeaders()).not.toHaveProperty('Authorization')
    expect(ghHeaders()['User-Agent']).toBe('STARfolio-ingest')
  })
})

describe('packZipBytes', () => {
  it('packs a well-formed archive', async () => {
    const zip = makeZip([
      { name: 'proj/README.md', data: '# Zipped\nUses Redis.' },
      { name: 'proj/app.py', data: 'print("hi")' }
    ])
    const { text, languages } = await packZipBytes(zip)
    expect(text).toContain('Uses Redis')
    expect(languages['.py']).toBe(1)
  })

  it('rejects a zip-slip entry that escapes the extraction folder', async () => {
    const evil = makeZip([{ name: '../escape.txt', data: 'pwned' }])
    await expect(packZipBytes(evil)).rejects.toThrow(/escape/i)
  })
})

describe('parseGitHubUrl', () => {
  it('parses owner/repo and optional ref via host allow-list', () => {
    expect(parseGitHubUrl('https://github.com/facebook/react')).toEqual({ owner: 'facebook', repo: 'react', ref: undefined })
    expect(parseGitHubUrl('https://github.com/a/b.git')).toMatchObject({ owner: 'a', repo: 'b' })
    expect(parseGitHubUrl('https://github.com/a/b/tree/dev')).toMatchObject({ owner: 'a', repo: 'b', ref: 'dev' })
    expect(() => parseGitHubUrl('https://gitlab.com/a/b')).toThrow()
    // hostname allow-list, not a substring match
    expect(() => parseGitHubUrl('https://evil.com/github.com/a/b')).toThrow()
    expect(() => parseGitHubUrl('not a url')).toThrow()
  })
})

describe('tar-stream (repo untar path)', () => {
  it('loads and round-trips a tar buffer', async () => {
    const tar = (await import('tar-stream')).default
    const pack = tar.pack()
    pack.entry({ name: 'proj/a.txt' }, 'hello')
    pack.finalize()
    const chunks: Buffer[] = []
    for await (const c of pack) chunks.push(c as Buffer)

    const extract = tar.extract()
    const names: string[] = []
    await new Promise<void>((res, rej) => {
      extract.on('entry', (h, s, next) => {
        names.push(h.name)
        s.on('end', next)
        s.resume()
      })
      extract.on('finish', () => res())
      extract.on('error', rej)
      extract.end(Buffer.concat(chunks))
    })
    expect(names).toContain('proj/a.txt')
  })
})
