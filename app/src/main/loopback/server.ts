import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { searchExperiences } from '../search'
import { generateStoryText, storyConfig, NoExperiencesError } from '../ai/story'

type Json = Record<string, unknown>

const MAX_BODY = 1_000_000

const LENGTH_MAP: Record<string, 'short' | 'medium' | 'detailed'> = {
  short: 'short',
  medium: 'medium',
  long: 'detailed',
  detailed: 'detailed'
}

let server: Server | null = null
let token: string | null = null

// Symmetric with PersonalServer's SUPERSTAR_LOOPBACK_FILE read override; falls back to the same
// userData folder that holds superstar.db so the C# side finds it with no config.
function loopbackFilePath(): string {
  return process.env.SUPERSTAR_LOOPBACK_FILE ?? join(app.getPath('userData'), 'loopback.json')
}

// Off by default. Env gate for now; a user-facing pref replaces this once settings land.
export function loopbackEnabled(): boolean {
  return process.env.STARFOLIO_LOOPBACK === '1'
}

export function startLoopbackServer(): Promise<void> {
  if (server) return Promise.resolve()
  token = randomBytes(32).toString('hex')
  const s = createServer(handle)
  server = s
  return new Promise((resolve) => {
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(loopbackFilePath(), JSON.stringify({ port, token }), {
        encoding: 'utf8',
        mode: 0o600
      })
      resolve()
    })
  })
}

export function stopLoopbackServer(): void {
  if (server) {
    server.close()
    server = null
  }
  token = null
  try {
    rmSync(loopbackFilePath(), { force: true })
  } catch {
    // Best-effort cleanup; a stale file just reads as "not running" to an unreachable socket.
  }
}

function authOk(req: IncomingMessage): boolean {
  if (!token) return false
  const header = req.headers['authorization']
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const provided = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function readJson(req: IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data) as Json)
      } catch {
        reject(new Error('malformed JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handleRetrieve(body: Json): Promise<Json> {
  const query = typeof body.query === 'string' ? body.query : ''
  const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : 10
  const hits = await searchExperiences({ query })
  return {
    results: hits.slice(0, limit).map((s) => ({
      experience_id: s.id,
      title: s.title,
      snippet: s.snippet
    }))
  }
}

async function handleGenerate(body: Json): Promise<[number, Json]> {
  const jd = typeof body.jd === 'string' ? body.jd.trim() : ''
  const genre = typeof body.genre === 'string' ? body.genre.trim() : ''
  let kind: 'jd' | 'genre'
  let promptText: string
  if (jd) {
    kind = 'jd'
    promptText = jd
  } else if (genre) {
    kind = 'genre'
    promptText = genre
  } else {
    return [400, { error: 'genre or jd is required' }]
  }
  const length = LENGTH_MAP[String(body.length ?? 'medium')] ?? 'medium'

  const parsed = storyConfig.safeParse({
    requestId: randomUUID(),
    experienceIds: body.experience_ids,
    kind,
    promptText,
    length
  })
  if (!parsed.success) return [400, { error: `invalid request: ${parsed.error.issues[0]?.message}` }]

  try {
    const { story, experienceIds } = await generateStoryText(parsed.data, new AbortController().signal)
    return [200, { story, experience_ids: experienceIds }]
  } catch (err) {
    if (err instanceof NoExperiencesError) return [400, { error: err.message }]
    return [500, { error: (err as Error).message }]
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
    if (!authOk(req)) return send(res, 401, { error: 'unauthorized' })
    const url = req.url ?? ''
    const body = await readJson(req)
    if (url === '/retrieve') return send(res, 200, await handleRetrieve(body))
    if (url === '/generate') {
      const [status, payload] = await handleGenerate(body)
      return send(res, status, payload)
    }
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: (err as Error).message })
  }
}
