import { execFileSync } from 'child_process'
import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { publishAgentCheckpoint } from './agent-checkpoint-publication'
import { stageObservationCheckpoint } from './observation-checkpoint'
import { decryptObservationCycle } from './observation-publication'
import type { RawObservation } from './observation-schema'
import { appendRawObservation } from './observation-store'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

describe('agent checkpoint publication', () => {
  let root: string
  let repository: string
  let remote: string
  let sourceRoot: string
  let publicKey: string
  let privateKey: string

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    publicKey = pair.publicKey
    privateKey = pair.privateKey
  })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'starfolio-agent-publish-'))
    repository = join(root, 'repository')
    remote = join(root, 'remote.git')
    sourceRoot = join(root, 'spool')
    mkdirSync(repository)
    mkdirSync(sourceRoot)
    git(root, ['init', '--bare', remote])
    git(repository, ['init'])
    git(repository, ['config', 'user.name', 'test'])
    git(repository, ['config', 'user.email', 'test@example.com'])
    writeFileSync(join(repository, 'README.md'), 'test\n')
    git(repository, ['add', 'README.md'])
    git(repository, ['commit', '-m', 'test: seed'])
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reopens the exact agent cycle from the durable branch', async () => {
    const runId = '11111111-1111-4111-8111-111111111111'
    const stepId = randomUUID()
    const worktreeStateHash = 'b'.repeat(64)
    const campaignId = randomUUID()
    const repositorySha = git(repository, ['rev-parse', 'HEAD'])
    const repositoryBranch = git(repository, ['branch', '--show-current'])
    const base: RawObservation = {
      schemaVersion: 2,
      agent: {
        runId,
        stepId,
        worktreeState: 'dirty',
        worktreeStateHash
      },
      eventId: randomUUID(),
      campaignId,
      eventKind: 'campaign-started',
      observedAt: '2026-09-20T12:00:00.000Z',
      repository: { sha: repositorySha, branch: repositoryBranch, worktree: repository },
      ci: { provider: null, runId: null, runAttempt: null, workflow: null, job: null },
      property: { id: 'agent/example', version: '1', invariant: 'value stays stable' },
      harnessVersion: '4',
      observationClass: 'organic',
      publicationClass: 'synthetic',
      seed: 42,
      replayPath: null,
      requestedRuns: 2,
      executedRuns: null,
      generatedCases: null,
      skippedCases: null,
      shrinkCount: null,
      counterexample: null,
      counterexampleHash: null,
      counterexampleCaptureStatus: null,
      counterexampleCaptureError: null,
      incidentFingerprint: null,
      failureText: null,
      failureTextCaptureStatus: null,
      failureTextCaptureError: null,
      environment: { platform: 'win32', arch: 'x64', nodeVersion: 'v22.0.0', ci: null },
      terminationStatus: 'started',
      summary: null
    }
    const completion: RawObservation = {
      ...base,
      eventId: randomUUID(),
      eventKind: 'campaign-completed',
      executedRuns: 2,
      generatedCases: 2,
      skippedCases: 0,
      shrinkCount: 0,
      terminationStatus: 'passed',
      summary: {
        requestedRuns: 2,
        executedRuns: 2,
        generatedCases: 2,
        skippedCases: 0,
        failureCount: 0
      }
    }
    appendRawObservation(sourceRoot, base)
    appendRawObservation(sourceRoot, completion)
    const checkpoint = stageObservationCheckpoint({
      sourceRoot,
      receiptRoot: join(root, 'receipts'),
      stagingRoot: join(root, 'staging'),
      sourceId: stepId
    })
    const publicKeyPath = join(root, 'public.pem')
    const privateKeyPath = join(root, 'private.pem')
    writeFileSync(publicKeyPath, publicKey)
    writeFileSync(privateKeyPath, privateKey)

    const published = await publishAgentCheckpoint(
      {
        ...checkpoint,
        cwd: repository,
        repositorySha,
        repositoryBranch,
        agentRunId: runId,
        stepId,
        worktreeState: 'dirty',
        worktreeStateHash,
        completedWorktreeStateHash: worktreeStateHash,
        worktreeChanged: false
      },
      {
        publicKeyPath,
        privateKeyPath,
        publicationRoot: join(root, 'publication'),
        durableWorkspaceRoot: join(root, 'durable-workspace'),
        remoteUrl: remote
      }
    )
    const retained = join(root, 'retained')
    git(root, ['clone', '--branch', 'pbt-observations', remote, retained])
    const cyclePath = join(retained, 'cycles', published.cycleRunId, '1')
    const keyId = createHash('sha256')
      .update(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))
      .digest('hex')
    const reopened = decryptObservationCycle({
      sourceRoot: cyclePath,
      privateKeys: { [keyId]: privateKey }
    })

    expect(published.cycleRunId).toMatch(/^agent-[a-f0-9]{32}$/)
    expect(reopened.manifest).toMatchObject({
      schemaVersion: 2,
      authority: {
        kind: 'local-agent',
        runId,
        stepId,
        worktreeStateHash,
        completedWorktreeStateHash: worktreeStateHash,
        worktreeChanged: false
      },
      rawEventIds: [base.eventId, completion.eventId].sort()
    })
    expect(readFileSync(join(cyclePath, 'payload.enc'))).toEqual(
      readFileSync(join(published.cyclePath, 'payload.enc'))
    )
  }, 20_000)
})
