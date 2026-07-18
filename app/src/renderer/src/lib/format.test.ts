import { describe, expect, it } from 'vitest'
import { slugify } from './format'

describe('slugify', () => {
  it('lowercases and hyphenates runs of non-word characters', () => {
    expect(slugify('Senior Backend Engineer')).toBe('senior-backend-engineer')
    expect(slugify('React / Node.js')).toBe('react-node-js')
  })

  it('collapses repeated separators into a single hyphen', () => {
    expect(slugify('a  --  b')).toBe('a-b')
  })

  it('trims leading and trailing separators', () => {
    expect(slugify('  Hello!  ')).toBe('hello')
    expect(slugify('***')).toBe('')
  })

  it('keeps underscores and digits as word characters', () => {
    expect(slugify('user_id 42')).toBe('user_id-42')
  })

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('')
  })
})
