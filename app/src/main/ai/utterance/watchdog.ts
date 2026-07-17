export const STALL_TIMEOUT_MS = 20_000
export const FIRST_TOKEN_TIMEOUT_MS = 12_000
export const STALL_CHECK_MS = 2_000

export interface StallTimer {
  start(onCheck: () => void): void
  stop(): void
}

export function intervalStallTimer(checkMs = STALL_CHECK_MS): StallTimer {
  let handle: ReturnType<typeof setInterval> | undefined
  return {
    start(onCheck) {
      handle = setInterval(onCheck, checkMs)
      handle.unref?.()
    },
    stop() {
      if (handle !== undefined) clearInterval(handle)
      handle = undefined
    }
  }
}
