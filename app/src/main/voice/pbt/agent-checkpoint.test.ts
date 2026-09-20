import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentChildEnvironment,
  resolveAgentCheckpointSpawn,
  runAgentCheckpointCommand
} from './agent-checkpoint'

const AGENT_RUN_ID = '11111111-1111-4111-8111-111111111111'

describe('agent checkpoint command', () => {
  let root: string
  let sourceRoot: string
  let receiptRoot: string
  let stagingRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'starfolio-agent-checkpoint-'))
    sourceRoot = join(root, 'spool')
    receiptRoot = join(root, 'receipts')
    stagingRoot = join(root, 'staging')
    mkdirSync(join(sourceRoot, 'raw'), { recursive: true })
    mkdirSync(receiptRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('passes only allowlisted runtime variables to test commands', () => {
    expect(
      createAgentChildEnvironment({
        PATH: 'bin',
        TEMP: 'temp',
        GIT_AUTH_TOKEN: 'secret',
        PBT_OBSERVATION_PRIVATE_KEYS: 'private',
        AWS_SECRET_ACCESS_KEY: 'cloud-secret'
      })
    ).toEqual({ PATH: 'bin' })
  })

  it('launches npm through its active Node CLI on Windows', () => {
    expect(
      resolveAgentCheckpointSpawn('npm', ['run', 'test'], 'win32', {
        npm_execpath: 'C:/node/npm-cli.js',
        npm_node_execpath: 'C:/node/node.exe'
      })
    ).toEqual({
      command: 'C:/node/node.exe',
      args: ['C:/node/npm-cli.js', 'run', 'test']
    })
    expect(resolveAgentCheckpointSpawn('npm', ['run', 'test'], 'linux', {})).toEqual({
      command: 'npm',
      args: ['run', 'test']
    })
  })

  it('fails clearly when Windows npm provenance is unavailable', () => {
    expect(() => resolveAgentCheckpointSpawn('npm', [], 'win32', {})).toThrow(/resolve npm/i)
  })

  it('publishes new command evidence before committing its receipt', async () => {
    let childEnvironment: NodeJS.ProcessEnv = {}
    const publish = vi.fn(async (checkpoint) => {
      expect(readdirSync(receiptRoot)).toEqual([])
      expect(checkpoint.files).toHaveLength(1)
    })

    const result = await runAgentCheckpointCommand(
      {
        cwd: root,
        command: 'test-command',
        args: [],
        sourceRoot,
        receiptRoot,
        stagingRoot,
        agentRunId: AGENT_RUN_ID
      },
      {
        captureWorktreeState: () => ({ status: 'dirty', hash: 'a'.repeat(64) }),
        runCommand: async (_command, _args, environment) => {
          childEnvironment = environment
          mkdirSync(join(environment.PBT_SPOOL_DIR!, 'raw'), { recursive: true })
          writeFileSync(join(environment.PBT_SPOOL_DIR!, 'raw', 'failure.json'), '{"failure":true}')
          return 7
        },
        publish
      }
    )

    expect(result.exitCode).toBe(7)
    expect(result.publishedFiles).toBe(1)
    expect(publish).toHaveBeenCalledOnce()
    expect(childEnvironment).toMatchObject({
      PBT_AGENT_RUN_ID: AGENT_RUN_ID,
      PBT_WORKTREE_STATE: 'dirty',
      PBT_WORKTREE_STATE_HASH: 'a'.repeat(64)
    })
    expect(childEnvironment.USERPROFILE).toContain(sourceRoot)
    expect(childEnvironment.APPDATA).toContain(sourceRoot)
    expect(childEnvironment.PBT_AGENT_STEP_ID).toMatch(/^[a-f0-9-]{36}$/)
    expect(readdirSync(receiptRoot)).toHaveLength(1)
  })

  it('keeps evidence unseen when durable publication fails', async () => {
    await expect(
      runAgentCheckpointCommand(
        {
          cwd: root,
          command: 'test-command',
          args: [],
          sourceRoot,
          receiptRoot,
          stagingRoot,
          agentRunId: AGENT_RUN_ID
        },
        {
          captureWorktreeState: () => ({ status: 'dirty', hash: 'a'.repeat(64) }),
          runCommand: async (_command, _args, environment) => {
            mkdirSync(join(environment.PBT_SPOOL_DIR!, 'raw'), { recursive: true })
            writeFileSync(
              join(environment.PBT_SPOOL_DIR!, 'raw', 'failure.json'),
              '{"failure":true}'
            )
            return 1
          },
          publish: async () => {
            throw new Error('durable append failed')
          }
        }
      )
    ).rejects.toThrow(/durable append/)
    expect(readdirSync(receiptRoot)).toEqual([])
  })

  it('retries a pending checkpoint with its original authority', async () => {
    const seenSteps: string[] = []
    let fail = true
    const publish = async (checkpoint: { stepId: string }): Promise<void> => {
      seenSteps.push(checkpoint.stepId)
      if (fail) {
        fail = false
        throw new Error('durable append failed')
      }
    }
    let originalStep = ''

    await expect(
      runAgentCheckpointCommand(
        {
          cwd: root,
          command: 'test-command',
          args: [],
          sourceRoot,
          receiptRoot,
          stagingRoot,
          agentRunId: AGENT_RUN_ID
        },
        {
          captureWorktreeState: () => ({ status: 'dirty', hash: 'a'.repeat(64) }),
          runCommand: async (_command, _args, environment) => {
            originalStep = environment.PBT_AGENT_STEP_ID!
            mkdirSync(join(environment.PBT_SPOOL_DIR!, 'raw'), { recursive: true })
            writeFileSync(join(environment.PBT_SPOOL_DIR!, 'raw', 'failure.json'), '{}')
            return 1
          },
          publish
        }
      )
    ).rejects.toThrow(/durable append/)

    const recovered = await runAgentCheckpointCommand(
      {
        cwd: root,
        command: 'test-command',
        args: [],
        sourceRoot,
        receiptRoot,
        stagingRoot,
        agentRunId: AGENT_RUN_ID
      },
      {
        captureWorktreeState: () => ({ status: 'clean', hash: 'b'.repeat(64) }),
        runCommand: async () => 0,
        publish
      }
    )

    expect(seenSteps).toEqual([originalStep, originalStep])
    expect(recovered.publishedFiles).toBe(0)
    expect(readdirSync(receiptRoot)).toHaveLength(1)
    expect(readdirSync(join(stagingRoot, 'completed'))).toHaveLength(1)
  })

  it('recovers an orphaned step journal after wrapper interruption', async () => {
    let recovered:
      | { stepId: string; worktreeChanged: boolean; completedWorktreeStateHash: string | null }
      | undefined

    await expect(
      runAgentCheckpointCommand(
        {
          cwd: root,
          command: 'test-command',
          args: [],
          sourceRoot,
          receiptRoot,
          stagingRoot,
          agentRunId: AGENT_RUN_ID
        },
        {
          captureWorktreeState: () => ({ status: 'dirty', hash: 'a'.repeat(64) }),
          runCommand: async (_command, _args, environment) => {
            mkdirSync(join(environment.PBT_SPOOL_DIR!, 'raw'), { recursive: true })
            writeFileSync(join(environment.PBT_SPOOL_DIR!, 'raw', 'failure.json'), '{}')
            throw new Error('wrapper interrupted')
          },
          publish: async () => undefined
        }
      )
    ).rejects.toThrow(/interrupted/)

    await runAgentCheckpointCommand(
      {
        cwd: root,
        command: 'test-command',
        args: [],
        sourceRoot,
        receiptRoot,
        stagingRoot,
        agentRunId: AGENT_RUN_ID
      },
      {
        captureWorktreeState: () => ({ status: 'clean', hash: 'b'.repeat(64) }),
        ownerIsActive: () => false,
        runCommand: async () => 0,
        publish: async (checkpoint) => {
          recovered ??= checkpoint
        }
      }
    )

    expect(recovered).toMatchObject({
      worktreeChanged: true,
      completedWorktreeStateHash: null
    })
    expect(readdirSync(receiptRoot)).toHaveLength(1)
  })

  it('isolates concurrent command spools by step identity', async () => {
    const snapshots = new Map<string, string>()
    let arrivals = 0
    let release: () => void = () => undefined
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    const runCommand = async (
      _command: string,
      _args: string[],
      environment: NodeJS.ProcessEnv
    ): Promise<number> => {
      const stepId = environment.PBT_AGENT_STEP_ID!
      mkdirSync(join(environment.PBT_SPOOL_DIR!, 'raw'), { recursive: true })
      writeFileSync(join(environment.PBT_SPOOL_DIR!, 'raw', 'event.json'), stepId)
      arrivals += 1
      if (arrivals === 2) release()
      await ready
      return 0
    }
    const publish = async (checkpoint: { stepId: string; snapshotRoot: string }): Promise<void> => {
      snapshots.set(
        checkpoint.stepId,
        readFileSync(join(checkpoint.snapshotRoot, 'raw', 'event.json'), 'utf8')
      )
    }
    const options = {
      cwd: root,
      command: 'test-command',
      args: [],
      sourceRoot,
      receiptRoot,
      stagingRoot,
      agentRunId: AGENT_RUN_ID
    }

    const results = await Promise.all([
      runAgentCheckpointCommand(options, {
        captureWorktreeState: () => ({ status: 'dirty', hash: 'a'.repeat(64) }),
        runCommand,
        publish
      }),
      runAgentCheckpointCommand(options, {
        captureWorktreeState: () => ({ status: 'dirty', hash: 'a'.repeat(64) }),
        runCommand,
        publish
      })
    ])

    expect(results.every((result) => result.publishedFiles === 1)).toBe(true)
    expect(snapshots.size).toBe(2)
    for (const [stepId, content] of snapshots) expect(content).toBe(stepId)
    expect(readdirSync(receiptRoot)).toHaveLength(2)
  })

  it('stays quiet when a command creates no unseen evidence', async () => {
    const publish = vi.fn()
    const result = await runAgentCheckpointCommand(
      {
        cwd: root,
        command: 'test-command',
        args: [],
        sourceRoot,
        receiptRoot,
        stagingRoot,
        agentRunId: AGENT_RUN_ID
      },
      {
        captureWorktreeState: () => ({ status: 'clean', hash: 'a'.repeat(64) }),
        runCommand: async () => 0,
        publish
      }
    )

    expect(result).toMatchObject({ exitCode: 0, publishedFiles: 0 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('fails before running when worktree identity is unavailable', async () => {
    const runCommand = vi.fn()

    await expect(
      runAgentCheckpointCommand(
        {
          cwd: root,
          command: 'test-command',
          args: [],
          sourceRoot,
          receiptRoot,
          stagingRoot,
          agentRunId: AGENT_RUN_ID
        },
        {
          captureWorktreeState: () => ({ status: 'unknown', hash: null }),
          runCommand,
          publish: vi.fn()
        }
      )
    ).rejects.toThrow(/worktree identity/)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('quarantines evidence when the command changes worktree identity', async () => {
    const states = [
      { status: 'dirty' as const, hash: 'a'.repeat(64) },
      { status: 'dirty' as const, hash: 'b'.repeat(64) }
    ]
    let publication:
      { worktreeChanged: boolean; completedWorktreeStateHash: string | null } | undefined

    await runAgentCheckpointCommand(
      {
        cwd: root,
        command: 'test-command',
        args: [],
        sourceRoot,
        receiptRoot,
        stagingRoot,
        agentRunId: AGENT_RUN_ID
      },
      {
        captureWorktreeState: () => states.shift()!,
        runCommand: async (_command, _args, environment) => {
          mkdirSync(join(environment.PBT_SPOOL_DIR!, 'raw'), { recursive: true })
          writeFileSync(join(environment.PBT_SPOOL_DIR!, 'raw', 'event.json'), '{}')
          return 0
        },
        publish: async (checkpoint) => {
          publication = checkpoint
        }
      }
    )

    expect(publication).toMatchObject({
      worktreeChanged: true,
      completedWorktreeStateHash: 'b'.repeat(64)
    })
  })
})
