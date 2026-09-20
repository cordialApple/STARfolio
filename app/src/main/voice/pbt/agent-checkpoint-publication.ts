import { createHash, createPublicKey } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { AgentCheckpointPublication } from './agent-checkpoint'
import {
  decryptAndValidateObservationCycle,
  encryptObservationCycle
} from './observation-publication'
import { appendDurableObservationCycle } from './retention-append'

export interface PublishAgentCheckpointOptions {
  publicKeyPath: string
  privateKeyPath: string
  publicationRoot: string
  durableWorkspaceRoot: string
  remoteUrl: string
}

export interface PublishedAgentCheckpoint {
  cyclePath: string
  cycleRunId: string
}

function privateKeyId(privateKey: Buffer): string {
  return createHash('sha256')
    .update(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

export async function publishAgentCheckpoint(
  checkpoint: AgentCheckpointPublication,
  options: PublishAgentCheckpointOptions
): Promise<PublishedAgentCheckpoint> {
  if (!/^[a-f0-9-]{36}$/.test(checkpoint.agentRunId)) throw new Error('Invalid PBT agent run ID')
  const cycleRunId = `agent-${createHash('sha256')
    .update(`${checkpoint.agentRunId}\0${checkpoint.stepId}\0${checkpoint.checkpointId}`)
    .digest('hex')
    .slice(0, 32)}`
  const runAttempt = '1'
  const publicKey = readFileSync(options.publicKeyPath)
  const privateKey = readFileSync(options.privateKeyPath)
  const encrypted = encryptObservationCycle({
    sourceRoot: checkpoint.snapshotRoot,
    destinationRoot: join(options.publicationRoot, 'encrypted'),
    publicKey,
    runId: cycleRunId,
    runAttempt
  })
  const trusted = decryptAndValidateObservationCycle({
    sourceRoot: encrypted.cyclePath,
    destinationRoot: join(options.publicationRoot, 'trusted'),
    privateKeys: { [privateKeyId(privateKey)]: privateKey },
    runId: cycleRunId,
    runAttempt,
    repositorySha: checkpoint.repositorySha,
    repositoryBranch: checkpoint.repositoryBranch,
    workflow: null,
    job: null,
    authority: {
      kind: 'local-agent',
      runId: checkpoint.agentRunId,
      stepId: checkpoint.stepId,
      worktreeStateHash: checkpoint.worktreeStateHash,
      completedWorktreeStateHash: checkpoint.completedWorktreeStateHash,
      worktreeChanged: checkpoint.worktreeChanged
    }
  })
  await appendDurableObservationCycle({
    workspaceRoot: options.durableWorkspaceRoot,
    remoteUrl: options.remoteUrl,
    cycleDirectory: trusted.cyclePath,
    runId: cycleRunId,
    runAttempt
  })
  return { cyclePath: trusted.cyclePath, cycleRunId }
}
