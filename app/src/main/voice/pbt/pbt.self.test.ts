import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { runProperty, replayRegression, fc } from './pbt'

describe('pbt harness self-test', () => {
  it('a false property throws and writes a shrunk counterexample artifact', () => {
    const artifact = join(process.cwd(), 'test-results', 'pbt', 'self-always-false.failure.json')
    rmSync(artifact, { force: true })
    expect(() =>
      runProperty('self/always-false', fc.integer({ min: 1, max: 100 }), (n) => n < 0)
    ).toThrow(/pbt\(self\/always-false\) failed/)
    expect(existsSync(artifact)).toBe(true)
    const payload = JSON.parse(readFileSync(artifact, 'utf8'))
    expect(payload.counterexample).toEqual([1])
    rmSync(artifact, { force: true })
  })

  it('restores Math.random and Date.now even when a property throws', () => {
    const random = Math.random
    const now = Date.now
    expect(() => runProperty('self/restore', fc.constant(0), () => false)).toThrow()
    expect(Math.random).toBe(random)
    expect(Date.now).toBe(now)
  })

  it('bans Math.random inside a property body', () => {
    expect(() => runProperty('self/no-random', fc.constant(0), () => Math.random() >= 0)).toThrow(
      /Math\.random\(\) is banned/
    )
  })

  it('replayRegression rethrows a case that still fails', () => {
    expect(() => replayRegression('self/regress', [1, 2], (n) => n > 10)).toThrow(/case 0 still fails/)
    expect(() => replayRegression('self/regress-ok', [1, 2], (n) => n > 0)).not.toThrow()
  })
})
