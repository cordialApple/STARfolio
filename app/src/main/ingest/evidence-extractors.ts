import { promises as fs, createWriteStream } from 'fs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, relative, sep, dirname, extname, basename } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { createGunzip } from 'zlib'

export interface PackResult {
  text: string
  languages: Record<string, number>
  tree: string
  truncated: boolean
}

const PACK_LIMITS = { maxTotalBytes: 5_000_000, maxFileBytes: 256_000 }
const ARCHIVE_LIMITS = { maxEntries: 20_000, maxTotalBytes: 50_000_000, maxFileBytes: 2_000_000 }
const HARD_SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage', '.turbo'])

function cellToStr(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown }
    if (o.text != null) return String(o.text)
    if (o.result != null) return String(o.result)
  }
  return String(v)
}

function numericSummary(rows: string[][]): string {
  if (rows.length < 2) return ''
  const [headers, ...body] = rows
  const lines: string[] = []
  headers.forEach((h, c) => {
    const nums = body.map((r) => Number(r[c])).filter((n) => Number.isFinite(n))
    if (nums.length === 0) return
    const sum = nums.reduce((a, b) => a + b, 0)
    lines.push(`${h || `col ${c + 1}`}: count=${nums.length} min=${Math.min(...nums)} max=${Math.max(...nums)} sum=${sum}`)
  })
  return lines.length ? 'Numeric summary:\n' + lines.join('\n') : ''
}

function sheetBlock(name: string, rows: string[][]): string {
  return [`Sheet: ${name}`, rows.map((r) => r.join('\t')).join('\n'), numericSummary(rows)]
    .filter(Boolean)
    .join('\n')
}

export async function sheetToText(filename: string, bytes: Uint8Array): Promise<string> {
  const ext = extname(filename).toLowerCase()
  if (ext === '.csv') {
    const Papa = (await import('papaparse')).default
    const parsed = Papa.parse<string[]>(new TextDecoder('utf-8').decode(bytes), { skipEmptyLines: true })
    return sheetBlock(basename(filename), parsed.data)
  }
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0])
  const blocks: string[] = []
  for (const ws of wb.worksheets) {
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1)
      rows.push(vals.map(cellToStr))
    })
    blocks.push(sheetBlock(ws.name, rows))
  }
  return blocks.join('\n\n')
}

export async function packFolder(root: string): Promise<PackResult> {
  const ignoreFactory = (await import('ignore')).default
  const { isBinaryFile } = await import('isbinaryfile')
  const ig = ignoreFactory()
  try {
    ig.add(await fs.readFile(join(root, '.gitignore'), 'utf8'))
  } catch {
    /* no .gitignore */
  }

  const posixRel = (abs: string): string => relative(root, abs).split(sep).join('/')
  const files: string[] = []
  const tree: string[] = []
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    for (const e of entries) {
      if (HARD_SKIP.has(e.name)) continue
      const abs = join(dir, e.name)
      const rel = posixRel(abs)
      if (ig.ignores(e.isDirectory() ? `${rel}/` : rel)) continue
      tree.push(prefix + e.name)
      if (e.isDirectory()) await walk(abs, `${prefix}  `)
      else files.push(abs)
    }
  }
  await walk(root, '')

  const parts: string[] = []
  const languages: Record<string, number> = {}
  let total = 0
  let truncated = false
  for (const abs of files) {
    const stat = await fs.stat(abs)
    if (stat.size > PACK_LIMITS.maxFileBytes) continue
    if (await isBinaryFile(abs)) continue
    if (total + stat.size > PACK_LIMITS.maxTotalBytes) {
      truncated = true
      break
    }
    const rel = posixRel(abs)
    total += stat.size
    const ext = extname(abs).toLowerCase() || '(none)'
    languages[ext] = (languages[ext] ?? 0) + 1
    parts.push(`\n${'='.repeat(16)}\nFILE: ${rel}\n${'='.repeat(16)}\n${await fs.readFile(abs, 'utf8')}`)
  }
  const treeStr = tree.join('\n')
  return { text: `File tree:\n${treeStr}\n${parts.join('\n')}`, languages, tree: treeStr, truncated }
}

function assertInside(root: string, target: string): void {
  if (target !== root && !target.startsWith(root + sep))
    throw new Error('Blocked an archive entry that escapes the extraction folder.')
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'starfolio-pack-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function packZipBytes(bytes: Uint8Array): Promise<PackResult> {
  return withTempDir(async (destRoot) => {
    const yauzl = (await import('yauzl')).default
    await new Promise<void>((res, rej) => {
      yauzl.fromBuffer(
        Buffer.from(bytes),
        { lazyEntries: true, validateEntrySizes: true },
        (err, zip) => {
          if (err || !zip) return rej(err ?? new Error('Could not read that archive.'))
          let entries = 0
          let totalBytes = 0
          zip.on('entry', (entry) => {
            try {
              if (++entries > ARCHIVE_LIMITS.maxEntries) throw new Error('Archive has too many files.')
              const name = entry.fileName.replace(/\\/g, '/')
              if (yauzl.validateFileName(name) != null) throw new Error(`Bad entry name: ${name}`)
              const outPath = resolve(destRoot, name)
              assertInside(destRoot, outPath)
              if (/\/$/.test(name)) {
                fs.mkdir(outPath, { recursive: true }).then(() => zip.readEntry(), rej)
                return
              }
              if (entry.uncompressedSize > ARCHIVE_LIMITS.maxFileBytes) {
                zip.readEntry()
                return
              }
              totalBytes += entry.uncompressedSize
              if (totalBytes > ARCHIVE_LIMITS.maxTotalBytes) throw new Error('Archive is too large.')
              zip.openReadStream(entry, (e, rs) => {
                if (e || !rs) return rej(e ?? new Error('read fail'))
                fs.mkdir(dirname(outPath), { recursive: true })
                  .then(() => pipeline(rs, createWriteStream(outPath)))
                  .then(() => zip.readEntry())
                  .catch(rej)
              })
            } catch (thrown) {
              rej(thrown as Error)
            }
          })
          zip.on('end', res)
          zip.on('error', rej)
          zip.readEntry()
        }
      )
    })
    return packFolder(destRoot)
  })
}

export interface RepoRef {
  owner: string
  repo: string
  ref?: string
}

export function parseGitHubUrl(url: string): RepoRef {
  const m = url.match(
    /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/#?]+))?(?:[/#?].*)?$/i
  )
  if (!m) throw new Error('That does not look like a GitHub repository URL.')
  return { owner: m[1], repo: m[2], ref: m[3] }
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'STARfolio-ingest',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

export async function packRepo(url: string, token?: string): Promise<PackResult & { title: string }> {
  const { owner, repo, ref } = parseGitHubUrl(url)
  let resolvedRef = ref
  if (!resolvedRef) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders(token) })
    if (r.status === 404) throw new Error('Repository not found (or private — add a token in Settings).')
    if (!r.ok) throw new Error(`GitHub returned ${r.status} looking up the repository.`)
    resolvedRef = (await r.json()).default_branch as string
  }
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/tarball/${resolvedRef}`,
    { headers: ghHeaders(token) }
  )
  if (res.status === 404) throw new Error('Repository not found (or private — add a token in Settings).')
  if (res.status === 403) throw new Error('GitHub rate limit hit — add a token in Settings and retry.')
  if (!res.ok || !res.body) throw new Error(`GitHub returned ${res.status} downloading the repository.`)

  const pack = await withTempDir(async (destRoot) => {
    const tarStream = (await import('tar-stream')).default
    const extract = tarStream.extract()
    let entries = 0
    let totalBytes = 0
    extract.on('entry', (header, stream, next) => {
      const rel = header.name.replace(/\\/g, '/').split('/').slice(1).join('/')
      if (!rel || header.type !== 'file') {
        stream.resume()
        return next()
      }
      if (++entries > ARCHIVE_LIMITS.maxEntries) return extract.destroy(new Error('Repository has too many files.'))
      const size = header.size ?? 0
      if (size > ARCHIVE_LIMITS.maxFileBytes) {
        stream.resume()
        return next()
      }
      totalBytes += size
      if (totalBytes > ARCHIVE_LIMITS.maxTotalBytes) return extract.destroy(new Error('Repository is too large.'))
      const outPath = resolve(destRoot, rel)
      try {
        assertInside(destRoot, outPath)
      } catch (e) {
        return extract.destroy(e as Error)
      }
      fs.mkdir(dirname(outPath), { recursive: true })
        .then(() => pipeline(stream, createWriteStream(outPath)))
        .then(next)
        .catch((e) => extract.destroy(e))
    })
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createGunzip(), extract)
    return packFolder(destRoot)
  })
  return { ...pack, title: `${owner}/${repo}` }
}
