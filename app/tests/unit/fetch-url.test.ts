import { describe, it, expect } from 'vitest'
import { assertPublicHttpUrl, ipInPrivateRange } from '../../src/main/ingest/fetch-url'

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

describe('ipInPrivateRange', () => {
  it('flags private, loopback, link-local and cloud-metadata IPv4', () => {
    for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.1', '192.168.0.1'])
      expect(ipInPrivateRange(ip), ip).toBe(true)
  })

  it('flags loopback, ULA, link-local and IPv4-mapped IPv6', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254'])
      expect(ipInPrivateRange(ip), ip).toBe(true)
  })

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])
      expect(ipInPrivateRange(ip), ip).toBe(false)
  })
})
