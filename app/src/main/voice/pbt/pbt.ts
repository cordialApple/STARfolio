import fc from 'fast-check'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export const PBT_SEED = Number(process.env.PBT_SEED ?? 202607)
export const PBT_RUNS = Number(process.env.PBT_RUNS ?? 200)

const ARTIFACT_DIR = join(process.cwd(), 'test-results', 'pbt')

export interface PropertyOptions {
  runs?: number
  seed?: number
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function writeArtifact(name: string, payload: unknown): string {
  const file = join(ARTIFACT_DIR, `${slug(name)}.failure.json`)
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  writeFileSync(file, JSON.stringify(payload, null, 2))
  return file
}

export function runProperty<T>(
  name: string,
  arb: fc.Arbitrary<T>,
  check: (value: T) => void | boolean,
  opts: PropertyOptions = {}
): void {
  const seed = opts.seed ?? PBT_SEED
  const numRuns = opts.runs ?? PBT_RUNS
  const realRandom = Math.random
  const realNow = Date.now
  Math.random = () => {
    throw new Error(`pbt(${name}): Math.random() is banned inside a property — inject determinism`)
  }
  Date.now = () => {
    throw new Error(`pbt(${name}): Date.now() is banned inside a property — inject a clock`)
  }
  try {
    const details = fc.check(fc.property(arb, check), { seed, numRuns })
    if (details.failed) {
      const reason = String((details as { errorInstance?: unknown }).errorInstance ?? '')
      const file = writeArtifact(name, {
        name,
        seed,
        numRuns,
        numShrinks: details.numShrinks,
        counterexample: details.counterexample,
        counterexamplePath: details.counterexamplePath,
        error: reason
      })
      throw new Error(
        `pbt(${name}) failed after ${details.numShrinks} shrinks (seed=${seed}, ` +
          `path=${details.counterexamplePath}). Counterexample written to ${file}\n` +
          `counterexample=${JSON.stringify(details.counterexample)}\n${reason}`
      )
    }
  } finally {
    Math.random = realRandom
    Date.now = realNow
  }
}

export function replayRegression<T>(name: string, cases: T[], check: (value: T) => void | boolean): void {
  for (const [i, value] of cases.entries()) {
    const ok = check(value)
    if (ok === false) {
      throw new Error(`pbt-regression(${name}) case ${i} still fails: ${JSON.stringify(value)}`)
    }
  }
}

export { fc }
