import { execFileSync } from 'child_process'
import { isAbsolute, join, resolve } from 'path'
import { publishAgentCheckpoint } from './agent-checkpoint-publication'
import { runAgentCheckpointCommand } from './agent-checkpoint'
import { resolveObservationRoot } from './observation-store'

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  const command = args.shift()
  if (!command) throw new Error('PBT checkpoint command is required')
  const repositoryRoot = git(cwd, ['rev-parse', '--show-toplevel'])
  const commonValue = git(cwd, ['rev-parse', '--git-common-dir'])
  const commonRoot = isAbsolute(commonValue) ? commonValue : resolve(cwd, commonValue)
  const stateRoot = join(commonRoot, 'pbt-agent-checkpoints')
  const privateKeyPath =
    process.env.PBT_OBSERVATION_PRIVATE_KEY_PATH ?? join(commonRoot, 'pbt-observation-private.pem')
  const publicKeyPath =
    process.env.PBT_OBSERVATION_PUBLIC_KEY_PATH ??
    join(repositoryRoot, '.github', 'pbt-observation-public.pem')
  const remoteUrl = process.env.PBT_REMOTE_URL ?? git(cwd, ['remote', 'get-url', 'origin'])
  const result = await runAgentCheckpointCommand(
    {
      cwd,
      command,
      args,
      sourceRoot: resolveObservationRoot(cwd),
      receiptRoot: join(stateRoot, 'receipts'),
      stagingRoot: join(stateRoot, 'staging'),
      agentRunId: requireEnvironment('PBT_AGENT_RUN_ID')
    },
    {
      publish: async (checkpoint) => {
        await publishAgentCheckpoint(checkpoint, {
          publicKeyPath,
          privateKeyPath,
          publicationRoot: join(stateRoot, 'publication'),
          durableWorkspaceRoot: join(stateRoot, 'durable-workspace'),
          remoteUrl
        })
      }
    }
  )
  process.stdout.write(
    `${JSON.stringify({
      checkpointId: result.checkpointId,
      stepId: result.stepId,
      publishedFiles: result.publishedFiles
    })}\n`
  )
  process.exitCode = result.exitCode
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
