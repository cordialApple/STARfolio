import { lookup } from 'dns/promises'
import { isIP } from 'net'

const MAX_HTML_BYTES = 5_000_000
const MAX_REDIRECTS = 5

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|172\.(1[6-9]|2\d|3[01])\.)/i

export function assertPublicHttpUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('That does not look like a valid URL.')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new Error('Only http and https links can be imported.')
  if (PRIVATE_HOST.test(u.hostname))
    throw new Error('Local and private-network addresses cannot be imported.')
  return u
}

export function ipInPrivateRange(ip: string): boolean {
  let addr = ip.toLowerCase()
  if (isIP(addr) === 6) {
    if (addr === '::1' || addr === '::') return true
    if (/^f[cd]/.test(addr)) return true
    if (/^fe[89ab]/.test(addr)) return true
    const mapped = addr.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/)
    if (!mapped) return false
    addr = mapped[1]
  }
  const parts = addr.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

// Resolve the host and reject if ANY resolved address is private — this catches the
// decimal/hex/octal/IPv6 encodings a hostname-string check misses, since they all
// resolve to a real address.
async function assertResolvesPublic(u: URL): Promise<void> {
  const addrs = await lookup(u.hostname, { all: true }).catch(() => [])
  if (addrs.length === 0) throw new Error('Could not resolve that host.')
  for (const { address } of addrs)
    if (ipInPrivateRange(address))
      throw new Error('That link resolves to a local or private-network address.')
}

export interface FetchedPage {
  html: string
  finalUrl: string
}

export async function fetchArticleHtml(raw: string): Promise<FetchedPage> {
  let current = assertPublicHttpUrl(raw)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Validate every hop before the request is made — redirect:'manual' means we,
      // not undici, decide whether to follow, so a 302 to a private IP never fires.
      await assertResolvesPublic(current)
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) STARfolio/0.1 (article importer)',
          accept: 'text/html,application/xhtml+xml'
        }
      })

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) throw new Error('The page redirected without a destination.')
        current = assertPublicHttpUrl(new URL(loc, current).href)
        continue
      }
      if (!res.ok) throw new Error(`The page returned ${res.status}.`)
      const type = res.headers.get('content-type') ?? ''
      if (!/text\/html|application\/xhtml/i.test(type))
        throw new Error('That link is not an HTML page.')

      const reader = res.body?.getReader()
      if (!reader) return { html: await res.text(), finalUrl: current.href }
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_HTML_BYTES) {
          await reader.cancel()
          throw new Error('That page is too large to import.')
        }
        chunks.push(value)
      }
      const buf = new Uint8Array(total)
      let off = 0
      for (const c of chunks) {
        buf.set(c, off)
        off += c.byteLength
      }
      return { html: new TextDecoder('utf-8').decode(buf), finalUrl: current.href }
    }
    throw new Error('That link redirected too many times.')
  } finally {
    clearTimeout(timer)
  }
}
