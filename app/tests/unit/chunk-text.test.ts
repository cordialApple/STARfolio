import { describe, it, expect } from 'vitest'
import { chunkText } from '../../src/main/db/repositories/corpus'

describe('chunkText edges', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\t  \n\n ')).toEqual([])
  })

  it('normalizes CRLF and merges small paragraphs under the target', () => {
    expect(chunkText('a\r\n\r\nb')).toEqual(['a\n\nb'])
  })

  it('packs paragraphs up to the target then flushes, preserving order', () => {
    const parts = chunkText('aaaa\n\nbbbb\n\ncccc', 10)
    expect(parts).toEqual(['aaaa\n\nbbbb', 'cccc'])
  })

  it('keeps an oversized-but-under-threshold paragraph whole', () => {
    const para = 'x'.repeat(14)
    expect(chunkText(para, 10)).toEqual([para])
  })

  it('hard-splits a paragraph past 1.5x the target into target-sized pieces', () => {
    const parts = chunkText('y'.repeat(20), 10)
    expect(parts).toEqual(['y'.repeat(10), 'y'.repeat(10)])
  })

  it('skips blank paragraphs between content', () => {
    expect(chunkText('one\n\n\n\ntwo', 100)).toEqual(['one\n\ntwo'])
  })
})
