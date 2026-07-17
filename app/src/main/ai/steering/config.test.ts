import { describe, expect, it } from 'vitest'
import { STEERING_CADENCE_MS, STEERING_MAX_AGE_MS, STEERING_WINDOW_MS } from './config'

describe('steering timing config', () => {
  it('all knobs are positive', () => {
    expect(STEERING_CADENCE_MS).toBeGreaterThan(0)
    expect(STEERING_WINDOW_MS).toBeGreaterThan(0)
    expect(STEERING_MAX_AGE_MS).toBeGreaterThan(0)
  })

  it('freshness gate outlives one cadence tick', () => {
    expect(STEERING_MAX_AGE_MS).toBeGreaterThanOrEqual(STEERING_CADENCE_MS)
  })

  it('window covers at least one cadence tick so no transcript gap between runs', () => {
    expect(STEERING_WINDOW_MS).toBeGreaterThanOrEqual(STEERING_CADENCE_MS)
  })
})
