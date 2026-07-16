import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { replayFetch, resolveAiFetch } from '../../src/main/ai/fixtures'

function keyFor(url: string, init?: { method?: string; body?: string }): string {
  const method = init?.method ?? 'POST'
  const body = typeof init?.body === 'string' ? init.body : ''
  return createHash('sha256').update(`${method}\n${url}\n${body}`).digest('hex')
}

const dirs: string[] = []
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'starfolio-fixtures-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  vi.unstubAllEnvs()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const URL = 'https://api.anthropic.com/v1/messages'

describe('replayFetch', () => {
  it('replays a recorded response by request hash', async () => {
    const dir = scratch()
    const init = { method: 'POST', body: '{"model":"x"}' }
    writeFileSync(
      join(dir, `${keyFor(URL, init)}.json`),
      JSON.stringify({ status: 201, headers: { 'x-fixture': '1' }, body: '{"ok":true}' })
    )
    const res = await replayFetch(dir)(URL, init)
    expect(res.status).toBe(201)
    expect(res.headers.get('x-fixture')).toBe('1')
    expect(await res.text()).toBe('{"ok":true}')
  })

  it('keys on method and body so a changed request misses', async () => {
    const dir = scratch()
    writeFileSync(
      join(dir, `${keyFor(URL, { method: 'POST', body: 'a' })}.json`),
      JSON.stringify({ status: 200, headers: {}, body: 'hit' })
    )
    const fetchFx = replayFetch(dir)
    expect(await (await fetchFx(URL, { method: 'POST', body: 'a' })).text()).toBe('hit')
    await expect(fetchFx(URL, { method: 'POST', body: 'b' })).rejects.toThrow('No AI fixture')
  })

  it('defaults the method to POST when none is given', async () => {
    const dir = scratch()
    writeFileSync(
      join(dir, `${keyFor(URL)}.json`),
      JSON.stringify({ status: 200, headers: {}, body: 'default-post' })
    )
    expect(await (await replayFetch(dir)(URL)).text()).toBe('default-post')
  })

  it('throws a loud, path-bearing error when the fixture is missing', async () => {
    await expect(replayFetch(scratch())(URL)).rejects.toThrow(
      /No AI fixture for this request at .*re-record with STARFOLIO_AI_RECORD_DIR/
    )
  })
})

describe('resolveAiFetch', () => {
  it('returns undefined when neither replay nor record dir is set', () => {
    expect(resolveAiFetch()).toBeUndefined()
  })

  it('prefers replay over record when both are set', async () => {
    vi.stubEnv('STARFOLIO_AI_REPLAY_DIR', scratch())
    vi.stubEnv('STARFOLIO_AI_RECORD_DIR', scratch())
    const f = resolveAiFetch()
    expect(f).toBeTypeOf('function')
    await expect(f!(URL)).rejects.toThrow('No AI fixture')
  })

  it('falls back to a record fetch when only the record dir is set', () => {
    vi.stubEnv('STARFOLIO_AI_RECORD_DIR', scratch())
    expect(resolveAiFetch()).toBeTypeOf('function')
  })
})
