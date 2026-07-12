import { describe, it, expect } from 'vitest'
import { assertPublicHttpUrl } from '../../src/main/ingest/fetch-url'

describe('assertPublicHttpUrl', () => {
  it('accepts public http and https urls', () => {
    expect(assertPublicHttpUrl('https://example.com/post').hostname).toBe('example.com')
    expect(assertPublicHttpUrl('http://blog.example.org/a').protocol).toBe('http:')
  })

  it('rejects non-http schemes', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow()
    expect(() => assertPublicHttpUrl('ftp://example.com')).toThrow()
    expect(() => assertPublicHttpUrl('not a url')).toThrow()
  })

  it('rejects local and private-network hosts (SSRF guard)', () => {
    for (const u of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://172.16.0.1/x',
      'http://[::1]/x'
    ])
      expect(() => assertPublicHttpUrl(u), u).toThrow()
  })
})
