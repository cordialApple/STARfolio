import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface Fixture {
  status: number
  headers: Record<string, string>
  body: string
}

function keyFor(input: string | URL | Request, init?: RequestInit): string {
  const url = typeof input === 'string' ? input : input.toString()
  const method = init?.method ?? 'POST'
  const body = typeof init?.body === 'string' ? init.body : ''
  return createHash('sha256').update(`${method}\n${url}\n${body}`).digest('hex')
}

// Replays recorded Anthropic responses from disk — no network, deterministic. Missing fixture
// throws loudly so a test that drifted from its recording fails instead of hitting the API.
export function replayFetch(dir: string): Fetch {
  return async (input, init) => {
    const path = join(dir, `${keyFor(input, init)}.json`)
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      throw new Error(`No AI fixture for this request at ${path} (re-record with STARFOLIO_AI_RECORD_DIR)`)
    }
    const fx = JSON.parse(raw) as Fixture
    return new Response(fx.body, { status: fx.status, headers: fx.headers })
  }
}

// Records real responses to disk keyed by request hash. Clones so the SDK still consumes the body.
export function recordFetch(dir: string): Fetch {
  return async (input, init) => {
    const res = await fetch(input as string | URL, init)
    const body = await res.clone().text()
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${keyFor(input, init)}.json`), JSON.stringify({ status: res.status, headers, body }, null, 2))
    return res
  }
}

export function resolveAiFetch(): Fetch | undefined {
  const replay = process.env.STARFOLIO_AI_REPLAY_DIR
  if (replay) return replayFetch(replay)
  const record = process.env.STARFOLIO_AI_RECORD_DIR
  if (record) return recordFetch(record)
  return undefined
}
