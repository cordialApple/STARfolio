import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { startLoopbackServer, stopLoopbackServer, loopbackEnabled } from '../../src/main/loopback/server'
import { setPrefs } from '../../src/main/settings/prefs'

let dir: string
let handshake: { port: number; token: string }

async function post(path: string, body: unknown, token = handshake.token): Promise<Response> {
  return fetch(`http://127.0.0.1:${handshake.port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
}

describe('loopback server', () => {
  beforeEach(async () => {
    process.env.STARFOLIO_AI_STUB = '1'
    dir = mkdtempSync(join(tmpdir(), 'star-loopback-'))
    process.env.SUPERSTAR_LOOPBACK_FILE = join(dir, 'loopback.json')
    initDb(':memory:')
    await startLoopbackServer()
    handshake = JSON.parse(readFileSync(process.env.SUPERSTAR_LOOPBACK_FILE, 'utf8'))
  })

  afterEach(() => {
    stopLoopbackServer()
    delete process.env.STARFOLIO_AI_STUB
    delete process.env.SUPERSTAR_LOOPBACK_FILE
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a handshake file with a port and token', () => {
    expect(handshake.port).toBeGreaterThan(0)
    expect(handshake.token).toHaveLength(64)
  })

  it('rejects a request with no / wrong bearer token', async () => {
    const res = await post('/retrieve', { query: 'x' }, 'wrong-token')
    expect(res.status).toBe(401)
  })

  it('retrieves experiences and maps them to the contract shape', async () => {
    createExperience({ title: 'Led a database migration', action: 'cutover with zero downtime' } as unknown)
    const res = await post('/retrieve', { query: 'migration', limit: 5 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results.length).toBeGreaterThan(0)
    const hit = body.results[0]
    expect(hit).toHaveProperty('experience_id')
    expect(hit).toHaveProperty('title')
    expect(hit).toHaveProperty('snippet')
  })

  it('generates a grounded story and returns provenance ids', async () => {
    const exp = createExperience({ title: 'Shipped the API', action: 'built and launched it' } as unknown)
    const res = await post('/generate', { experience_ids: [exp.id], genre: 'Leadership', length: 'long' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.story).toBe('string')
    expect(body.story.length).toBeGreaterThan(0)
    expect(body.experience_ids).toEqual([exp.id])
  })

  it('rejects a generate request with neither genre nor jd', async () => {
    const res = await post('/generate', { experience_ids: ['a'] })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/genre or jd/)
  })
})

describe('loopbackEnabled gate', () => {
  beforeEach(() => {
    delete process.env.STARFOLIO_LOOPBACK
    initDb(':memory:')
  })
  afterEach(() => delete process.env.STARFOLIO_LOOPBACK)

  it('is off by default and follows the pref', () => {
    expect(loopbackEnabled()).toBe(false)
    setPrefs({ loopbackEnabled: true })
    expect(loopbackEnabled()).toBe(true)
  })

  it('honors the env override even when the pref is off', () => {
    process.env.STARFOLIO_LOOPBACK = '1'
    expect(loopbackEnabled()).toBe(true)
  })
})
