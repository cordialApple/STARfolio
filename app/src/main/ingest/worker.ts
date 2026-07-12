import { createRequire } from 'module'
import { dirname, join } from 'path'
import { detectFileKind, decodeText, extractDocx, extractPdf, looksScanned, htmlToArticle } from './extractors'
import { fetchArticleHtml } from './fetch-url'

type Request =
  | { type: 'parseDoc'; id: string; filename: string; bytes: Uint8Array }
  | { type: 'parseUrl'; id: string; url: string }

interface DocResult {
  text: string
  scanned: boolean
  meta: Record<string, unknown>
}
interface UrlResult {
  text: string
  title: string | null
  finalUrl: string
  meta: Record<string, unknown>
}
type Reply =
  | { id: string; ok: true; doc: DocResult }
  | { id: string; ok: true; url: UrlResult }
  | { id: string; ok: false; error: string }

interface ParentPort {
  on(event: 'message', listener: (e: { data: Request }) => void): void
  postMessage(message: Reply): void
}
const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

// pdfjs treats a utilityProcess (process.type === 'utility') as a browser and then
// demands a Web Worker; present it as the main process so pdfjs takes its Node path
// (an in-process fake worker, no workerSrc needed).
try {
  Object.defineProperty(process, 'type', { value: 'browser', configurable: true })
} catch {
  /* read-only in some builds; pdfjs will still fall back to the fake worker */
}

// pdfjs-dist's canvas module references these DOM globals at eval time even for
// text-only extraction; a utilityProcess is pure Node with no DOM, so stub them.
const glob = globalThis as Record<string, unknown>
if (typeof glob.DOMMatrix === 'undefined') {
  glob.DOMMatrix = class {}
  glob.Path2D = class {}
  glob.ImageData = class {}
}

const require_ = createRequire(__filename)
function standardFontDataUrl(): string {
  return join(dirname(require_.resolve('pdfjs-dist/package.json')), 'standard_fonts/')
}

async function parseDoc(filename: string, bytes: Uint8Array): Promise<DocResult> {
  const kind = detectFileKind(filename)
  if (!kind) throw new Error('Unsupported file type. Try txt, md, docx, or pdf.')
  if (kind === 'txt' || kind === 'md')
    return { text: decodeText(bytes).trim(), scanned: false, meta: { kind } }
  if (kind === 'docx') return { text: await extractDocx(bytes), scanned: false, meta: { kind } }
  const { text, numPages } = await extractPdf(bytes, standardFontDataUrl())
  return { text, scanned: looksScanned(text, numPages), meta: { kind, numPages } }
}

async function parseUrl(url: string): Promise<UrlResult> {
  const { html, finalUrl } = await fetchArticleHtml(url)
  const article = await htmlToArticle(html, finalUrl)
  if (!article) throw new Error('Could not find a readable article on that page.')
  return {
    text: article.markdown,
    title: article.title,
    finalUrl,
    meta: { kind: 'url', sourceUrl: finalUrl }
  }
}

parentPort.on('message', (e) => {
  const msg = e.data
  void (async () => {
    try {
      if (msg.type === 'parseDoc')
        parentPort.postMessage({ id: msg.id, ok: true, doc: await parseDoc(msg.filename, msg.bytes) })
      else if (msg.type === 'parseUrl')
        parentPort.postMessage({ id: msg.id, ok: true, url: await parseUrl(msg.url) })
    } catch (err) {
      parentPort.postMessage({ id: msg.id, ok: false, error: (err as Error).message })
    }
  })()
})
