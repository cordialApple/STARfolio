import { execFileSync, spawnSync } from 'child_process'
import { createHash, createPublicKey, generateKeyPairSync } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runAgentCheckpointCommand } from './agent-checkpoint'
import { publishAgentCheckpoint } from './agent-checkpoint-publication'
import { decryptObservationCycle } from './observation-publication'
import type { RawObservation } from './observation-schema'
import { defineSyntheticProperty, fc, runProperty } from './pbt'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function gitExit(cwd: string, args: string[]): number {
  return spawnSync('git', args, { cwd, stdio: 'ignore' }).status ?? 1
}

function createObservationKeys(root: string): {
  publicKey: string
  privateKey: string
  publicKeyPath: string
  privateKeyPath: string
} {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const publicKeyPath = join(root, 'public.pem')
  const privateKeyPath = join(root, 'private.pem')
  writeFileSync(publicKeyPath, keys.publicKey)
  writeFileSync(privateKeyPath, keys.privateKey)
  return { ...keys, publicKeyPath, privateKeyPath }
}

function getPrivateKeyId(privateKey: string): string {
  return createHash('sha256')
    .update(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

function withEnvironment<T>(environment: NodeJS.ProcessEnv, action: () => T): T {
  const names = [
    'PBT_AGENT_RUN_ID',
    'PBT_AGENT_STEP_ID',
    'PBT_WORKTREE_STATE',
    'PBT_WORKTREE_STATE_HASH'
  ] as const
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  for (const name of names) process.env[name] = environment[name]
  try {
    return action()
  } finally {
    for (const name of names) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

describe('agent failure-to-fix retention', () => {
  it('reopens pre-fix and post-fix campaigns after source removal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'starfolio-agent-lifecycle-'))
    try {
      const repository = join(root, 'repository')
      const remote = join(root, 'remote.git')
      const sourceRoot = join(root, 'spool')
      const receiptRoot = join(root, 'receipts')
      const stagingRoot = join(root, 'staging')
      const publicationRoot = join(root, 'publication')
      const durableWorkspaceRoot = join(root, 'durable-workspace')
      mkdirSync(repository)
      mkdirSync(sourceRoot)
      git(root, ['init', '--bare', remote])
      git(repository, ['init', '-b', 'main'])
      git(repository, ['config', 'user.name', 'test'])
      git(repository, ['config', 'user.email', 'test@example.com'])
      writeFileSync(join(repository, 'property.txt'), 'baseline\n')
      git(repository, ['add', 'property.txt'])
      git(repository, ['commit', '-m', 'test: seed'])
      git(repository, ['checkout', '-b', 'feat/lifecycle-fix'])
      writeFileSync(join(repository, 'property.txt'), 'broken\n')
      const keys = createObservationKeys(root)
      const metadata = defineSyntheticProperty(
        'agent/lifecycle',
        '1',
        'fix makes the property pass',
        'sabotage'
      )
      const agentRunId = '11111111-1111-4111-8111-111111111111'
      const publish = (checkpoint: Parameters<typeof publishAgentCheckpoint>[0]) =>
        publishAgentCheckpoint(checkpoint, {
          publicKeyPath: keys.publicKeyPath,
          privateKeyPath: keys.privateKeyPath,
          publicationRoot,
          durableWorkspaceRoot,
          remoteUrl: remote
        }).then(() => undefined)
      const run = () =>
        runAgentCheckpointCommand(
          {
            cwd: repository,
            command: 'synthetic-property',
            args: [],
            sourceRoot,
            receiptRoot,
            stagingRoot,
            agentRunId
          },
          {
            runCommand: async (_command, _args, environment) =>
              withEnvironment(environment, () => {
                try {
                  runProperty(
                    metadata,
                    fc.constant(null),
                    () => readFileSync(join(repository, 'property.txt'), 'utf8') === 'fixed\n',
                    {
                      runs: 1,
                      seed: 42,
                      observationRoot: environment.PBT_SPOOL_DIR
                    }
                  )
                  return 0
                } catch {
                  return 1
                }
              }),
            publish
          }
        )

      const failed = await run()
      const failedRawBytes = readdirSync(join(sourceRoot, failed.stepId, 'raw')).map((name) =>
        readFileSync(join(sourceRoot, failed.stepId, 'raw', name))
      )
      writeFileSync(join(repository, 'property.txt'), 'fixed\n')
      const passed = await run()

      expect(failed.exitCode).toBe(1)
      expect(passed.exitCode).toBe(0)
      expect(failed.checkpointId).not.toBeNull()
      expect(passed.checkpointId).not.toBeNull()
      git(repository, ['add', 'property.txt'])
      git(repository, ['commit', '-m', 'fix: repair property'])
      const featureCommit = git(repository, ['rev-parse', 'HEAD'])
      git(repository, ['checkout', 'main'])
      git(repository, ['merge', '--squash', 'feat/lifecycle-fix'])
      git(repository, ['commit', '-m', 'fix: merge property repair'])
      git(repository, ['branch', '-D', 'feat/lifecycle-fix'])
      expect(git(repository, ['branch', '--list', 'feat/lifecycle-fix'])).toBe('')
      expect(gitExit(repository, ['merge-base', '--is-ancestor', featureCommit, 'HEAD'])).toBe(1)
      rmSync(repository, { recursive: true, force: true })
      rmSync(sourceRoot, { recursive: true, force: true })

      const retained = join(root, 'retained')
      git(root, ['clone', '--branch', 'pbt-observations', remote, retained])
      const keyId = getPrivateKeyId(keys.privateKey)
      const entries = readdirSync(join(retained, 'cycles')).flatMap((runId) => {
        const cyclePath = join(retained, 'cycles', runId, '1')
        return decryptObservationCycle({
          sourceRoot: cyclePath,
          privateKeys: { [keyId]: keys.privateKey }
        }).entries
      })
      const events = entries.flatMap((entry) =>
        entry.path.startsWith('raw/') && entry.path.endsWith('.json')
          ? [JSON.parse(entry.bytes.toString('utf8')) as RawObservation]
          : []
      )
      const lifecycle = events.filter((event) => event.property.id === metadata.id)
      const failedEvent = lifecycle.find((event) => event.eventKind === 'failure-observed')
      expect(failedEvent).toBeDefined()
      const failedCampaign = lifecycle.filter(
        (event) => event.campaignId === failedEvent?.campaignId
      )
      const passedCampaign = lifecycle.filter(
        (event) => event.eventKind === 'campaign-completed' && event.terminationStatus === 'passed'
      )
      const stateHashes = new Set(
        lifecycle.flatMap((event) =>
          event.schemaVersion === 2 && event.agent?.worktreeStateHash
            ? [event.agent.worktreeStateHash]
            : []
        )
      )

      expect(lifecycle.filter((event) => event.eventKind === 'failure-observed')).toHaveLength(1)
      expect(failedCampaign.map((event) => event.eventKind).sort()).toEqual([
        'campaign-completed',
        'campaign-started',
        'failure-observed'
      ])
      expect(
        failedCampaign.find((event) => event.eventKind === 'campaign-completed')?.summary
      ).toMatchObject({ requestedRuns: 1, executedRuns: 1, generatedCases: 1, failureCount: 1 })
      expect(passedCampaign).toHaveLength(1)
      expect(passedCampaign[0].summary).toMatchObject({
        requestedRuns: 1,
        executedRuns: 1,
        generatedCases: 1,
        failureCount: 0
      })
      expect(
        lifecycle.every(
          (event) => event.observationClass === 'sabotage' && event.publicationClass === 'synthetic'
        )
      ).toBe(true)
      expect(
        new Set(lifecycle.map((event) => event.schemaVersion === 2 && event.agent?.runId))
      ).toEqual(new Set([agentRunId]))
      expect(stateHashes).toHaveLength(2)
      const retainedRawHashes = new Set(
        entries
          .filter((entry) => entry.path.startsWith('raw/') && entry.path.endsWith('.json'))
          .map((entry) => createHash('sha256').update(entry.bytes).digest('hex'))
      )
      for (const bytes of failedRawBytes)
        expect(retainedRawHashes).toContain(createHash('sha256').update(bytes).digest('hex'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('captures through the process-level checkpoint command', () => {
    const root = mkdtempSync(join(tmpdir(), 'starfolio-agent-cli-'))
    try {
      const appRoot = process.cwd()
      const repository = join(root, 'repository')
      const remote = join(root, 'remote.git')
      const retained = join(root, 'retained')
      const childPath = join(root, 'emit-malformed.mjs')
      const malformed = '{"schemaVersion":'
      mkdirSync(repository)
      git(root, ['init', '--bare', remote])
      git(repository, ['init', '-b', 'main'])
      git(repository, ['config', 'user.name', 'test'])
      git(repository, ['config', 'user.email', 'test@example.com'])
      writeFileSync(join(repository, 'tracked.txt'), 'baseline\n')
      writeFileSync(
        join(repository, 'package.json'),
        `${JSON.stringify({ scripts: { emit: 'node ../emit-malformed.mjs' } }, null, 2)}\n`
      )
      git(repository, ['add', 'tracked.txt', 'package.json'])
      git(repository, ['commit', '-m', 'test: seed'])
      const keys = createObservationKeys(root)
      writeFileSync(
        childPath,
        [
          "import { mkdirSync, writeFileSync } from 'node:fs'",
          "import { join } from 'node:path'",
          'if (process.env.PBT_TEST_SECRET) process.exit(9)',
          "mkdirSync(join(process.env.PBT_SPOOL_DIR, 'raw'), { recursive: true })",
          `writeFileSync(join(process.env.PBT_SPOOL_DIR, 'raw', 'partial.json'), ${JSON.stringify(malformed)})`,
          'process.exit(7)'
        ].join('\n')
      )
      const result = spawnSync(
        process.execPath,
        [
          join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          join(appRoot, 'src', 'main', 'voice', 'pbt', 'agent-checkpoint-cli.ts'),
          '--',
          'npm',
          'run',
          'emit'
        ],
        {
          cwd: repository,
          encoding: 'utf8',
          env: {
            ...process.env,
            PBT_AGENT_RUN_ID: '22222222-2222-4222-8222-222222222222',
            PBT_OBSERVATION_PUBLIC_KEY_PATH: keys.publicKeyPath,
            PBT_OBSERVATION_PRIVATE_KEY_PATH: keys.privateKeyPath,
            PBT_REMOTE_URL: remote,
            PBT_TEST_SECRET: 'must-not-reach-child'
          }
        }
      )

      expect(result.status, result.stderr).toBe(7)
      const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!) as {
        checkpointId: string | null
        publishedFiles: number
      }
      expect(report.checkpointId).toMatch(/^[a-f0-9-]{36}$/)
      expect(report.publishedFiles).toBe(1)
      git(root, ['clone', '--branch', 'pbt-observations', remote, retained])
      const keyId = getPrivateKeyId(keys.privateKey)
      const runId = readdirSync(join(retained, 'cycles'))[0]
      const decrypted = decryptObservationCycle({
        sourceRoot: join(retained, 'cycles', runId, '1'),
        privateKeys: { [keyId]: keys.privateKey }
      })
      expect(decrypted.entries).toHaveLength(1)
      expect(decrypted.entries[0].path).toBe('raw/partial.json')
      expect(decrypted.entries[0].bytes.toString('utf8')).toBe(malformed)
      expect(
        readdirSync(join(retained, 'cycles', runId, '1'))
          .map((name) => readFileSync(join(retained, 'cycles', runId, '1', name), 'utf8'))
          .join('')
      ).not.toContain('PRIVATE KEY')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
