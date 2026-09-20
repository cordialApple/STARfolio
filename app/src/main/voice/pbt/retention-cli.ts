import { readFileSync } from 'fs'
import {
  decryptAndValidateObservationCycle,
  encryptObservationCycle
} from './observation-publication'

function requireEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const mode = requireEnvironment('PBT_RETENTION_MODE')
const identity = {
  runId: process.env.PBT_RUN_ID ?? requireEnvironment('GITHUB_RUN_ID'),
  runAttempt: process.env.PBT_RUN_ATTEMPT ?? requireEnvironment('GITHUB_RUN_ATTEMPT')
}
const sourceRoot = requireEnvironment('PBT_SPOOL_DIR')
const destinationRoot = requireEnvironment('PBT_PUBLICATION_DIR')

function readPrivateKeys(): Record<string, string> {
  const value: unknown = JSON.parse(requireEnvironment('PBT_OBSERVATION_PRIVATE_KEYS'))
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    throw new Error('PBT_OBSERVATION_PRIVATE_KEYS must be a JSON object')
  const entries = Object.entries(value)
  if (
    entries.length === 0 ||
    entries.some(([id, key]) => !/^[a-f0-9]{64}$/.test(id) || typeof key !== 'string')
  )
    throw new Error('PBT_OBSERVATION_PRIVATE_KEYS contains an invalid key entry')
  return Object.fromEntries(entries) as Record<string, string>
}

function runRetention():
  | ReturnType<typeof encryptObservationCycle>
  | ReturnType<typeof decryptAndValidateObservationCycle> {
  if (mode === 'encrypt') {
    return encryptObservationCycle({
      sourceRoot,
      destinationRoot,
      ...identity,
      publicKey: readFileSync(requireEnvironment('PBT_PUBLIC_KEY_PATH'))
    })
  }
  if (mode === 'validate') {
    return decryptAndValidateObservationCycle({
      sourceRoot,
      destinationRoot,
      ...identity,
      privateKeys: readPrivateKeys(),
      repositorySha: process.env.PBT_REPOSITORY_SHA ?? process.env.GITHUB_SHA ?? null,
      repositoryBranch:
        process.env.PBT_REPOSITORY_BRANCH ??
        process.env.GITHUB_HEAD_REF ??
        process.env.GITHUB_REF_NAME ??
        null,
      workflow: process.env.PBT_WORKFLOW ?? process.env.GITHUB_WORKFLOW ?? null,
      job: process.env.PBT_JOB ?? process.env.GITHUB_JOB ?? null
    })
  }
  throw new Error(`Unsupported PBT retention mode: ${mode}`)
}

const result = runRetention()

process.stdout.write(`${JSON.stringify({ cyclePath: result.cyclePath })}\n`)
