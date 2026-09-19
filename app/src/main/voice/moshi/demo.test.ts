import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { MoshiDemoSession, selectDemoEvidence, checkDemoHealth } from './demo'

const servers: WebSocketServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

function server(): { server: WebSocketServer; endpoint: string } {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  servers.push(server)
  return { server, endpoint: '' }
}

const record = {
  id: 'one',
  title: 'Demo',
  situation: 'Situation',
  task: 'Task',
  action: 'Action',
  result_text: 'Result'
}

describe('Moshi demo evidence', () => {
  it('exports only selected STAR fields and rejects unknown IDs', () => {
    const get = (id: string) => (id === 'one' ? { ...record, secret: 'never export' } : null)
    expect(selectDemoEvidence(['one', 'one'], get)).toEqual([
      {
        id: 'one',
        title: 'Demo',
        text: 'Situation: Situation\nTask: Task\nAction: Action\nResult: Result'
      }
    ])
    expect(() => selectDemoEvidence(['missing'], get)).toThrow(
      'Selected experience no longer exists'
    )
    expect(() => selectDemoEvidence([], get)).toThrow()
  })
  it('rejects oversized evidence rather than silently dropping content', () => {
    expect(() =>
      selectDemoEvidence(['one'], () => ({ ...record, action: 'x'.repeat(50_000) }))
    ).toThrow('Selected evidence exceeds')
  })
})

describe('Moshi demo transport', () => {
  it('refuses non-loopback endpoints and excessive session duration', async () => {
    const session = new MoshiDemoSession(() => {})
    await expect(session.start('ws://example.com/session', [], 120)).rejects.toThrow('loopback')
    await expect(session.start('ws://127.0.0.1:8765/session', [], 1801)).rejects.toThrow('duration')
  })
  it('waits for ready, exchanges PCM and ends the connection', async () => {
    const { server: ws } = server()
    await new Promise<void>((resolve) => ws.on('listening', resolve))
    const address = ws.address() as { port: number }
    const received: unknown[] = []
    ws.on('connection', (socket) => {
      socket.on('message', (data, binary) => {
        if (binary) {
          const bytes = data as Buffer
          received.push(
            Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readFloatLE(index * 4))
          )
          socket.send(data)
          return
        }
        const message = JSON.parse(data.toString())
        received.push(message)
        if (message.type === 'start') socket.send(JSON.stringify({ type: 'ready', mode: 'moshi' }))
        if (message.type === 'end') socket.close()
      })
    })
    const events: unknown[] = []
    const session = new MoshiDemoSession((event) => events.push(event))
    await session.start(
      `ws://127.0.0.1:${address.port}/session`,
      [{ id: 'one', title: 'Demo', text: 'Evidence' }],
      120
    )
    session.audio(new Float32Array([0.25, -0.5]))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(received[0]).toEqual({
      type: 'start',
      evidence: [{ id: 'one', title: 'Demo', text: 'Evidence' }],
      durationSeconds: 120
    })
    expect(received[1]).toEqual([0.25, -0.5])
    expect(events).toContainEqual({ type: 'ready', mode: 'moshi' })
    expect(events).toContainEqual({ type: 'audio', samples: new Float32Array([0.25, -0.5]) })
    session.end()
    expect(events).toContainEqual({ type: 'ended', reason: 'Ended by user' })
  })
  it('rejects a gateway error before ready', async () => {
    const { server: ws } = server()
    await new Promise<void>((resolve) => ws.on('listening', resolve))
    const address = ws.address() as { port: number }
    ws.on('connection', (socket) =>
      socket.send(JSON.stringify({ type: 'error', message: 'Worker unavailable' }))
    )
    const session = new MoshiDemoSession(() => {})
    await expect(session.start(`ws://127.0.0.1:${address.port}/session`, [], 120)).rejects.toThrow(
      'Worker unavailable'
    )
    session.end()
  })
})

describe('Moshi demo lifecycle', () => {
  it('cancels warmup without waiting for ready', async () => {
    const { server: ws } = server()
    await new Promise<void>((resolve) => ws.on('listening', resolve))
    const address = ws.address() as { port: number }
    const events: unknown[] = []
    const session = new MoshiDemoSession((event) => events.push(event))
    const connecting = session.start(`ws://127.0.0.1:${address.port}/session`, [], 120)
    const rejected = expect(connecting).rejects.toThrow('Ended by user')
    session.end()
    session.end()
    await rejected
    expect(events).toEqual([{ type: 'ended', reason: 'Ended by user' }])
  })
  it('ends on malformed gateway audio and stops accepting microphone frames', async () => {
    const { server: ws } = server()
    await new Promise<void>((resolve) => ws.on('listening', resolve))
    const address = ws.address() as { port: number }
    ws.on('connection', (socket) => {
      socket.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'start')
          socket.send(JSON.stringify({ type: 'ready', mode: 'moshi' }))
      })
    })
    const events: unknown[] = []
    const session = new MoshiDemoSession((event) => events.push(event))
    await session.start(`ws://127.0.0.1:${address.port}/session`, [], 120)
    for (const client of ws.clients) client.send(Buffer.from([1, 2, 3]))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(events).toContainEqual({ type: 'error', message: 'Invalid gateway audio' })
    expect(events).toContainEqual({ type: 'ended', reason: 'Invalid gateway audio' })
    session.audio(new Float32Array([0.5]))
  })
})

describe('Moshi demo connection check', () => {
  it('reads health without starting a session or sending evidence', async () => {
    const paths: string[] = []
    const http = createServer((request, response) => {
      paths.push(request.url ?? '')
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({ mode: 'fixture', interviewProtocol: 1, upstreamReady: true, busy: false })
      )
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    try {
      const address = http.address() as { port: number }
      await expect(checkDemoHealth(`ws://127.0.0.1:${address.port}/session`)).resolves.toEqual({
        mode: 'fixture',
        interviewProtocol: 1,
        upstreamReady: true,
        busy: false
      })
      expect(paths).toEqual(['/health'])
      await expect(checkDemoHealth('ws://example.com/session')).rejects.toThrow('loopback')
    } finally {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  })
  it('preserves fixture mode and rejects an unknown ready mode', async () => {
    const { server: ws } = server()
    await new Promise<void>((resolve) => ws.on('listening', resolve))
    const address = ws.address() as { port: number }
    let mode = 'fixture'
    ws.on('connection', (socket) =>
      socket.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'start')
          socket.send(JSON.stringify({ type: 'ready', mode }))
      })
    )
    const fixture = new MoshiDemoSession(() => {})
    await expect(fixture.start(`ws://127.0.0.1:${address.port}/session`, [], 120)).resolves.toBe(
      'fixture'
    )
    fixture.end()
    mode = 'unknown'
    const unknown = new MoshiDemoSession(() => {})
    await expect(unknown.start(`ws://127.0.0.1:${address.port}/session`, [], 120)).rejects.toThrow(
      'Unknown gateway mode'
    )
  })
})

it('sends roadmap revisions and preserves overlapping speaker segments', async () => {
  const { server: ws } = server()
  await new Promise<void>((resolve) => ws.on('listening', resolve))
  const address = ws.address() as { port: number }
  const received: Record<string, unknown>[] = []
  ws.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      received.push(message)
      if (message.type === 'start') {
        socket.send(JSON.stringify({ type: 'ready', mode: 'moshi' }))
        socket.send(
          JSON.stringify({
            type: 'segment',
            speaker: 'interviewer',
            text: 'Tell me',
            startMs: 100,
            endMs: 400,
            truncated: true
          })
        )
        socket.send(
          JSON.stringify({
            type: 'segment',
            speaker: 'candidate',
            text: 'I built',
            startMs: 250,
            endMs: 600,
            truncated: false
          })
        )
        socket.send(JSON.stringify({ type: 'gap', atMs: 1200 }))
      }
    })
  })
  const events: unknown[] = []
  const session = new MoshiDemoSession((event) => events.push(event))
  const context = {
    revision: 0,
    roadmap: { topics: [], objectives: ['Ownership'] },
    action: { authority: 'command' as const, intent: { kind: 'ask_intro' as const } }
  }
  await session.start(`ws://127.0.0.1:${address.port}/session`, [], 120, context)
  expect(session.condition({ ...context, revision: 1 })).toBe(true)
  expect(session.condition(context)).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(received[0].conditioning).toEqual(context)
  expect(received[1]).toEqual({ type: 'conditioning', context: { ...context, revision: 1 } })
  expect(events).toContainEqual({
    type: 'segment',
    speaker: 'candidate',
    text: 'I built',
    startMs: 250,
    endMs: 600,
    truncated: false
  })
  expect(events).toContainEqual({
    type: 'segment',
    speaker: 'interviewer',
    text: 'Tell me',
    startMs: 100,
    endMs: 400,
    truncated: true
  })
  expect(events).toContainEqual({ type: 'gap', atMs: 1200 })
  session.end()
  expect(session.condition({ ...context, revision: 2 })).toBe(false)
})

it('keeps final transcript until the gateway acknowledges graceful end', async () => {
  const { server: ws } = server()
  await new Promise<void>((resolve) => ws.on('listening', resolve))
  const address = ws.address() as { port: number }
  const events: { type: string }[] = []
  ws.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'start') socket.send(JSON.stringify({ type: 'ready', mode: 'moshi' }))
      if (message.type === 'end') {
        socket.send(
          JSON.stringify({
            type: 'segment',
            speaker: 'candidate',
            text: 'Final evidence',
            startMs: 1000,
            endMs: 1200,
            truncated: true
          })
        )
        socket.send(JSON.stringify({ type: 'ended', reason: 'client-ended' }))
      }
    })
  })
  const session = new MoshiDemoSession((event) => events.push(event))
  await session.start(`ws://127.0.0.1:${address.port}/session`, [], 120, {
    revision: 0,
    roadmap: { topics: [], objectives: [] },
    action: { authority: 'command', intent: { kind: 'ask_intro' } }
  })
  session.end()
  expect(events.map((event) => event.type)).toEqual(['ready'])
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(events.map((event) => event.type)).toEqual(['ready', 'segment', 'ended'])
})

it('rejects legacy gateway health before interview setup', async () => {
  const http = createServer((_request, response) => {
    response.end(JSON.stringify({ mode: 'moshi', upstreamReady: true, busy: false }))
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  try {
    const address = http.address() as { port: number }
    await expect(checkDemoHealth(`ws://127.0.0.1:${address.port}/session`)).rejects.toThrow(
      'Invalid gateway health response'
    )
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
})
