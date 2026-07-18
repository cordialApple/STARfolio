import { describe, it, expect, vi, afterEach } from 'vitest'
import { createEmbedDrainer } from '../../src/main/embed/drain'

afterEach(() => vi.useRealTimers())

function drainerOver(queue: string[], overrides: Partial<Parameters<typeof createEmbedDrainer>[0]> = {}) {
  const stored = new Map<string, string>()
  const embed = vi.fn(async (text: string) => `vec-${text}`)
  const drainer = createEmbedDrainer<string, string>({
    nextPending: () => queue[0],
    resolveText: (id) => `text-${id}`,
    embed,
    store: (id, v) => void stored.set(id, v),
    drop: (id) => void queue.splice(queue.indexOf(id), 1),
    ...overrides
  })
  return { drainer, stored, embed }
}

describe('createEmbedDrainer', () => {
  it('embeds, stores, and drops every pending id in order', async () => {
    const queue = ['a', 'b', 'c']
    const { drainer, stored, embed } = drainerOver(queue)
    drainer.kick()
    await vi.waitFor(() => expect(queue.length).toBe(0))
    expect(embed.mock.calls.map((c) => c[0])).toEqual(['text-a', 'text-b', 'text-c'])
    expect([...stored.entries()]).toEqual([
      ['a', 'vec-text-a'],
      ['b', 'vec-text-b'],
      ['c', 'vec-text-c']
    ])
  })

  it('drops a null-passage id without embedding or storing it', async () => {
    const queue = ['a', 'b', 'c']
    const { drainer, stored, embed } = drainerOver(queue, {
      resolveText: (id) => (id === 'b' ? null : `text-${id}`)
    })
    drainer.kick()
    await vi.waitFor(() => expect(queue.length).toBe(0))
    expect(embed.mock.calls.map((c) => c[0])).toEqual(['text-a', 'text-c'])
    expect(stored.has('b')).toBe(false)
  })

  it('ignores a concurrent kick while already draining', async () => {
    const queue = ['a']
    let release!: (v: string) => void
    const embed = vi.fn(() => new Promise<string>((r) => (release = r)))
    const drainer = createEmbedDrainer<string, string>({
      nextPending: () => queue[0],
      resolveText: (id) => `text-${id}`,
      embed,
      store: () => {},
      drop: (id) => void queue.splice(queue.indexOf(id), 1)
    })
    drainer.kick()
    drainer.kick()
    await Promise.resolve()
    expect(embed).toHaveBeenCalledTimes(1)
    release('vec')
    await vi.waitFor(() => expect(queue.length).toBe(0))
  })

  it('schedules a retry on failure and drains once the model recovers', async () => {
    vi.useFakeTimers()
    const queue = ['a']
    const stored = new Map<string, string>()
    let attempt = 0
    const embed = vi.fn(async (text: string) => {
      if (++attempt === 1) throw new Error('model down')
      return `vec-${text}`
    })
    const drainer = createEmbedDrainer<string, string>({
      nextPending: () => queue[0],
      resolveText: (id) => `text-${id}`,
      embed,
      store: (id, v) => void stored.set(id, v),
      drop: (id) => void queue.splice(queue.indexOf(id), 1),
      retryMs: 1000
    })
    drainer.kick()
    await vi.advanceTimersByTimeAsync(0)
    expect(queue).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(queue).toEqual([])
    expect(stored.get('a')).toBe('vec-text-a')
    expect(embed).toHaveBeenCalledTimes(2)
  })
})
