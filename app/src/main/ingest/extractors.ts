export type FileKind = 'txt' | 'md' | 'docx' | 'pdf'

const EXT_KIND: Record<string, FileKind> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  docx: 'docx',
  pdf: 'pdf'
}

export function detectFileKind(filename: string): FileKind | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_KIND[ext] ?? null
}

export function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export async function extractDocx(bytes: Uint8Array): Promise<string> {
  const mod = (await import('mammoth')) as unknown as {
    default?: { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> }
    extractRawText?: (o: { buffer: Buffer }) => Promise<{ value: string }>
  }
  const mammoth = mod.default ?? mod
  const { value } = await mammoth.extractRawText!({ buffer: Buffer.from(bytes) })
  return value.trim()
}

export interface PdfText {
  text: string
  numPages: number
}

export async function extractPdf(bytes: Uint8Array, standardFontDataUrl: string): Promise<PdfText> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({
    data: Uint8Array.from(bytes),
    standardFontDataUrl: standardFontDataUrl.replace(/\\/g, '/').replace(/\/?$/, '/'),
    useSystemFonts: true
  })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const line = content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
      pages.push(line.replace(/[ \t]+/g, ' ').trim())
      page.cleanup()
    }
    return { text: pages.filter(Boolean).join('\n\n'), numPages: doc.numPages }
  } finally {
    await task.destroy()
  }
}

export function looksScanned(text: string, numPages: number): boolean {
  const glyphs = text.replace(/\s/g, '').length
  return glyphs < Math.max(20, numPages * 15)
}

export interface Article {
  title: string | null
  markdown: string
}

export async function htmlToArticle(html: string, url: string): Promise<Article | null> {
  const { JSDOM } = await import('jsdom')
  const { Readability } = await import('@mozilla/readability')
  const dom = new JSDOM(html, { url })
  try {
    const parsed = new Readability(dom.window.document).parse()
    if (!parsed?.content) return null

    const Turndown = (await import('turndown')).default
    const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
    td.remove(['script', 'style', 'nav', 'footer', 'aside'])
    const markdown = td.turndown(parsed.content).trim()
    return { title: parsed.title?.trim() || null, markdown }
  } finally {
    dom.window.close()
  }
}
