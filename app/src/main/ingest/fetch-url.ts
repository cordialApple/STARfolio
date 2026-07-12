const MAX_HTML_BYTES = 5_000_000

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

export interface FetchedPage {
  html: string
  finalUrl: string
}

export async function fetchArticleHtml(raw: string): Promise<FetchedPage> {
  const u = assertPublicHttpUrl(raw)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) STARfolio/0.1 (article importer)',
        accept: 'text/html,application/xhtml+xml'
      }
    })
    if (!res.ok) throw new Error(`The page returned ${res.status}.`)
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(type))
      throw new Error('That link is not an HTML page.')
    assertPublicHttpUrl(res.url || u.href)

    const reader = res.body?.getReader()
    if (!reader) return { html: await res.text(), finalUrl: res.url || u.href }
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
    return { html: new TextDecoder('utf-8').decode(buf), finalUrl: res.url || u.href }
  } finally {
    clearTimeout(timer)
  }
}
