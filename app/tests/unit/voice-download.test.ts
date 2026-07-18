import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { downloadToFile } from '../../src/main/voice/download'

function tmpDest(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dl-'))
  return join(dir, 'out.bin')
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    }
  })
}

function fakeResponse(opts: {
  ok: boolean
  status: number
  chunks?: Uint8Array[]
  contentLength?: string
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    body: opts.ok ? streamOf(opts.chunks ?? []) : null,
    headers: { get: () => opts.contentLength ?? null }
  } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('downloadToFile', () => {
  it('writes the streamed bytes to dest and reports progress', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          chunks: [payload.slice(0, 5), payload.slice(5)],
          contentLength: '10'
        })
      )
    )
    const dest = tmpDest()
    const pcts: number[] = []
    await downloadToFile('http://x', dest, (p) => pcts.push(p), 0)

    expect(readFileSync(dest)).toEqual(Buffer.from(payload))
    expect(existsSync(`${dest}.download`)).toBe(false)
    expect(pcts).toEqual([50, 99])
    rmSync(dest, { force: true })
  })

  it('falls back to expectedBytes when content-length is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, chunks: [new Uint8Array(50)] })
      )
    )
    const dest = tmpDest()
    const pcts: number[] = []
    await downloadToFile('http://x', dest, (p) => pcts.push(p), 100)

    expect(pcts).toEqual([50])
    rmSync(dest, { force: true })
  })

  it('throws "download failed: <status>" and leaves no partial file on a bad response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ ok: false, status: 503 })))
    const dest = tmpDest()

    await expect(downloadToFile('http://x', dest, () => {}, 0)).rejects.toThrow('download failed: 503')
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.download`)).toBe(false)
  })
})
