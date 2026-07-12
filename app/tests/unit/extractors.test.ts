import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import {
  detectFileKind,
  decodeText,
  extractDocx,
  extractPdf,
  looksScanned,
  htmlToArticle
} from '../../src/main/ingest/extractors'

const FIX = fileURLToPath(new URL('../fixtures/ingest/', import.meta.url))
const fontDir = join(
  dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
  'standard_fonts/'
)
const read = (name: string): Buffer => readFileSync(join(FIX, name))

describe('detectFileKind', () => {
  it('maps known extensions and rejects the rest', () => {
    expect(detectFileKind('a.PDF')).toBe('pdf')
    expect(detectFileKind('a.docx')).toBe('docx')
    expect(detectFileKind('notes.md')).toBe('md')
    expect(detectFileKind('a.markdown')).toBe('md')
    expect(detectFileKind('a.txt')).toBe('txt')
    expect(detectFileKind('a.pages')).toBeNull()
    expect(detectFileKind('noext')).toBeNull()
  })
})

describe('decodeText', () => {
  it('decodes utf-8 and strips a BOM', () => {
    expect(decodeText(read('resume.txt'))).toContain('Jordan Rivera')
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi')
  })
})

describe('extractDocx', () => {
  it('pulls paragraph text out of a docx', async () => {
    const text = await extractDocx(read('sample.docx'))
    expect(text).toContain('Cut the deploy time')
    expect(text).toContain('eight minutes')
  })
})

describe('extractPdf', () => {
  it('extracts the text layer and is not flagged scanned', async () => {
    const { text, numPages } = await extractPdf(read('resume.pdf'), fontDir)
    expect(numPages).toBe(1)
    expect(text).toContain('Jordan Rivera')
    expect(text).toContain('twenty minutes')
    expect(looksScanned(text, numPages)).toBe(false)
  })

  it('flags a text-less (scanned) pdf', async () => {
    const { text, numPages } = await extractPdf(read('scanned.pdf'), fontDir)
    expect(looksScanned(text, numPages)).toBe(true)
  })
})

// jsdom + readability cold-start parsing runs ~5s; give these headroom over the 5s default.
describe('htmlToArticle', () => {
  it('extracts the article title and markdown, dropping nav/script chrome', { timeout: 20000 }, async () => {
    const html = read('article.html').toString('utf8')
    const article = await htmlToArticle(html, 'https://example.com/post')
    expect(article).not.toBeNull()
    expect(article!.title).toMatch(/cut deploy time/i)
    expect(article!.markdown).toContain('eight minutes')
    expect(article!.markdown).not.toContain('tracking pixel')
    expect(article!.markdown).not.toContain('Home')
  })

  it('returns null for a page with no readable content', { timeout: 20000 }, async () => {
    const article = await htmlToArticle('<html><body></body></html>', 'https://example.com')
    expect(article).toBeNull()
  })
})
