import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function loadConfig(ci: string | undefined) {
  vi.stubEnv('CI', ci)
  vi.resetModules()
  return (await import('../../vitest.config')).default
}

describe('vitest config', () => {
  it('runs test files serially in CI', async () => {
    const config = await loadConfig('true')

    expect(config.test?.maxWorkers).toBe(1)
    expect(config.test?.testTimeout).toBeUndefined()
  })

  it.each([
    ['unset', undefined],
    ['false', 'false']
  ])('keeps local runner defaults when CI is %s', async (_state, ci) => {
    const config = await loadConfig(ci)

    expect(config.test?.maxWorkers).toBeUndefined()
    expect(config.test?.testTimeout).toBeUndefined()
  })
})
