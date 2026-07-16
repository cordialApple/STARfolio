import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordFetch } from '../../src/main/ai/fixtures'

function keyFor(url: string, init?: { method?: string; body?: string }): string {
  const method = init?.method ?? 'POST'
  const body = typeof init?.body === 'string' ? init.body : ''
  return createHash('sha256').update(`${method}\n${url}\n${body}`).digest('hex')
}

const dirs: string[] = []
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'starfolio-record-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  vi.unstubAllGlobals()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const URL = 'https://api.anthropic.com/v1/messages'

describe('recordFetch', () => {
  it('writes the upstream response to disk keyed by request hash and passes it through', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('recorded-body', { status: 202, headers: { 'x-fixture': 'y' } })
    )
    const dir = scratch()
    const init = { method: 'POST', body: '{"model":"x"}' }
    const res = await recordFetch(dir)(URL, init)
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('recorded-body')

    const saved = JSON.parse(readFileSync(join(dir, `${keyFor(URL, init)}.json`), 'utf8'))
    expect(saved.status).toBe(202)
    expect(saved.body).toBe('recorded-body')
    expect(saved.headers['x-fixture']).toBe('y')
  })
})
