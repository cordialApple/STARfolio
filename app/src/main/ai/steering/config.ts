export const STEERING_CADENCE_MS = 15_000

export const STEERING_WINDOW_MS = 15_000

// Freshness gate must outlive one cadence tick, else a signal from run N expires
// before run N+1 fires and every turn falls back to inline eval — see config.test.ts.
export const STEERING_MAX_AGE_MS = 20_000
