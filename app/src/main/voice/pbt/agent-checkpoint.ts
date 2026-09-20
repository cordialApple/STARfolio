import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { captureAgentWorktreeState, type AgentWorktreeState } from './agent-worktree'
import {
  commitObservationCheckpoint,
  stageObservationCheckpoint,
  type ObservationCheckpoint
} from './observation-checkpoint'
import { collectObservationProvenance } from './observation-store'

const SHA256 = /^[a-f0-9]{64}$/

const checkpointFileSchema = z
  .object({ path: z.string(), sha256: z.string().regex(SHA256) })
  .strict()

const publicationFields = {
  checkpointId: z.string().uuid(),
  sourceId: z.string().min(1),
  snapshotRoot: z.string().min(1),
  files: z.array(checkpointFileSchema),
  cwd: z.string().min(1),
  repositorySha: z.string().nullable(),
  repositoryBranch: z.string().nullable(),
  agentRunId: z.string().uuid(),
  stepId: z.string().uuid(),
  worktreeState: z.enum(['clean', 'dirty']),
  worktreeStateHash: z.string().regex(SHA256),
  completedWorktreeStateHash: z.string().regex(SHA256).nullable(),
  worktreeChanged: z.boolean()
}

const pendingPublicationSchema = z
  .object({ schemaVersion: z.literal(1), ...publicationFields })
  .strict()

const stepSchema = z
  .object({
    schemaVersion: z.literal(1),
    stepId: z.string().uuid(),
    sourceRoot: z.string().min(1),
    cwd: z.string().min(1),
    repositorySha: z.string().nullable(),
    repositoryBranch: z.string().nullable(),
    agentRunId: z.string().uuid(),
    worktreeState: z.enum(['clean', 'dirty']),
    worktreeStateHash: z.string().regex(SHA256),
    ownerPid: z.number().int().positive()
  })
  .strict()

const finishedStepSchema = z
  .object({
    schemaVersion: z.literal(1),
    stepId: z.string().uuid(),
    completedWorktreeStateHash: z.string().regex(SHA256).nullable(),
    worktreeChanged: z.boolean()
  })
  .strict()

type AgentStep = z.infer<typeof stepSchema>
type FinishedAgentStep = z.infer<typeof finishedStepSchema>

export interface AgentCheckpointCommandOptions {
  cwd: string
  command: string
  args: string[]
  sourceRoot: string
  receiptRoot: string
  stagingRoot: string
  agentRunId: string
}

export interface AgentCheckpointPublication extends ObservationCheckpoint {
  cwd: string
  repositorySha: string | null
  repositoryBranch: string | null
  agentRunId: string
  stepId: string
  worktreeState: Exclude<AgentWorktreeState['status'], 'unknown'>
  worktreeStateHash: string
  completedWorktreeStateHash: string | null
  worktreeChanged: boolean
}

export interface AgentCheckpointCommandResult {
  exitCode: number
  publishedFiles: number
  checkpointId: string | null
  stepId: string
}

export interface AgentCheckpointDependencies {
  captureWorktreeState?: (cwd: string) => AgentWorktreeState
  ownerIsActive?: (ownerPid: number) => boolean
  runCommand?: (
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
    cwd: string
  ) => Promise<number>
  publish: (checkpoint: AgentCheckpointPublication) => Promise<void>
}

export interface AgentCheckpointSpawn {
  command: string
  args: string[]
}

const CHILD_ENVIRONMENT_NAMES = [
  'COMSPEC',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'Path',
  'PROCESSOR_ARCHITECTURE',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'SHELL',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR'
] as const

export function createAgentChildEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of CHILD_ENVIRONMENT_NAMES) {
    const value = parent[name]
    if (value !== undefined) environment[name] = value
  }
  return environment
}

function createRuntimeEnvironment(root: string): NodeJS.ProcessEnv {
  const home = join(root, 'home')
  const appData = join(root, 'app-data')
  const localAppData = join(root, 'local-app-data')
  const temporary = join(root, 'temp')
  const config = join(root, 'config')
  const cache = join(root, 'cache')
  for (const path of [home, appData, localAppData, temporary, config, cache])
    mkdirSync(path, { recursive: true })
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache
  }
}

function spawnCommand(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string
): Promise<number> {
  const spawnTarget = resolveAgentCheckpointSpawn(command, args)
  return new Promise((resolve, reject) => {
    const child = spawn(spawnTarget.command, spawnTarget.args, {
      cwd,
      env: environment,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(signal === null ? (code ?? 1) : 1))
  })
}

export function resolveAgentCheckpointSpawn(
  command: string,
  args: string[],
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): AgentCheckpointSpawn {
  if (platform !== 'win32' || !['npm', 'npm.cmd'].includes(command.toLowerCase()))
    return { command, args }
  const npmExecPath = environment.npm_execpath
  if (!npmExecPath) throw new Error('PBT checkpoint cannot resolve npm on Windows')
  return {
    command: environment.npm_node_execpath ?? process.execPath,
    args: [npmExecPath, ...args]
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function writeImmutableRecord(root: string, id: string, value: unknown): string {
  mkdirSync(root, { recursive: true })
  const destination = join(root, `${id}.json`)
  const bytes = `${JSON.stringify(value, null, 2)}\n`
  if (existsSync(destination)) {
    if (readFileSync(destination, 'utf8') !== bytes)
      throw new Error(`PBT checkpoint record ${id} already differs`)
    return destination
  }
  const temporary = join(dirname(root), `.${id}.${process.pid}.${randomUUID()}.tmp`)
  const handle = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(handle, bytes, 'utf8')
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  try {
    renameSync(temporary, destination)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    if (existsSync(destination) && readFileSync(destination, 'utf8') === bytes) return destination
    throw error
  }
  return destination
}

function readRecords<T>(root: string, schema: z.ZodType<T>): T[] {
  if (!existsSync(root)) return []
  if (!lstatSync(root).isDirectory()) throw new Error(`PBT checkpoint root ${root} is invalid`)
  return readdirSync(root)
    .sort(compareText)
    .map((name) => {
      if (!name.endsWith('.json')) throw new Error(`PBT checkpoint record ${name} is invalid`)
      const parsed = schema.parse(JSON.parse(readFileSync(join(root, name), 'utf8')))
      const ids = parsed as { checkpointId?: string; stepId?: string }
      const id = ids.checkpointId ?? ids.stepId
      if (name !== `${id}.json`)
        throw new Error(`PBT checkpoint record ${name} has mismatched identity`)
      return parsed
    })
}

function readCompletedIds(stagingRoot: string): Set<string> {
  const schema = z.object({ checkpointId: z.string().uuid() }).strict()
  return new Set(
    readRecords(join(stagingRoot, 'completed'), schema).map((entry) => entry.checkpointId)
  )
}

function readPendingPublications(stagingRoot: string): AgentCheckpointPublication[] {
  const completed = readCompletedIds(stagingRoot)
  return readRecords(join(stagingRoot, 'pending'), pendingPublicationSchema).filter(
    (entry) => !completed.has(entry.checkpointId)
  )
}

function recordPendingPublication(
  stagingRoot: string,
  publication: AgentCheckpointPublication
): void {
  writeImmutableRecord(join(stagingRoot, 'pending'), publication.checkpointId, {
    schemaVersion: 1,
    ...publication
  })
}

function recordCompletedPublication(stagingRoot: string, checkpointId: string): void {
  writeImmutableRecord(join(stagingRoot, 'completed'), checkpointId, { checkpointId })
}

async function completePublication(
  options: AgentCheckpointCommandOptions,
  dependencies: AgentCheckpointDependencies,
  publication: AgentCheckpointPublication
): Promise<void> {
  await dependencies.publish(publication)
  commitObservationCheckpoint(options.receiptRoot, publication)
  recordCompletedPublication(options.stagingRoot, publication.checkpointId)
}

function ownerIsActive(ownerPid: number): boolean {
  try {
    process.kill(ownerPid, 0)
    return true
  } catch {
    return false
  }
}

async function captureStepEvidence(
  options: AgentCheckpointCommandOptions,
  dependencies: AgentCheckpointDependencies,
  step: AgentStep,
  finished: FinishedAgentStep | null
): Promise<{ checkpointId: string | null; publishedFiles: number }> {
  const checkpoint = stageObservationCheckpoint({
    sourceRoot: step.sourceRoot,
    receiptRoot: options.receiptRoot,
    stagingRoot: options.stagingRoot,
    sourceId: step.stepId
  })
  if (checkpoint.files.length === 0) return { checkpointId: null, publishedFiles: 0 }
  const publication: AgentCheckpointPublication = {
    ...checkpoint,
    cwd: step.cwd,
    repositorySha: step.repositorySha,
    repositoryBranch: step.repositoryBranch,
    agentRunId: step.agentRunId,
    stepId: step.stepId,
    worktreeState: step.worktreeState,
    worktreeStateHash: step.worktreeStateHash,
    completedWorktreeStateHash: finished?.completedWorktreeStateHash ?? null,
    worktreeChanged: finished?.worktreeChanged ?? true
  }
  recordPendingPublication(options.stagingRoot, publication)
  await completePublication(options, dependencies, publication)
  return { checkpointId: checkpoint.checkpointId, publishedFiles: checkpoint.files.length }
}

async function recoverCheckpointState(
  options: AgentCheckpointCommandOptions,
  dependencies: AgentCheckpointDependencies
): Promise<void> {
  for (const pending of readPendingPublications(options.stagingRoot))
    await completePublication(options, dependencies, pending)
  const finished = new Map(
    readRecords(join(options.stagingRoot, 'finished'), finishedStepSchema).map((entry) => [
      entry.stepId,
      entry
    ])
  )
  for (const step of readRecords(join(options.stagingRoot, 'steps'), stepSchema)) {
    const completion = finished.get(step.stepId) ?? null
    if (completion === null && (dependencies.ownerIsActive ?? ownerIsActive)(step.ownerPid))
      continue
    await captureStepEvidence(options, dependencies, step, completion)
  }
}

export async function runAgentCheckpointCommand(
  options: AgentCheckpointCommandOptions,
  dependencies: AgentCheckpointDependencies
): Promise<AgentCheckpointCommandResult> {
  z.string().uuid().parse(options.agentRunId)
  if (!options.command.trim()) throw new Error('PBT checkpoint command is required')
  await recoverCheckpointState(options, dependencies)
  const captureWorktreeState = dependencies.captureWorktreeState ?? captureAgentWorktreeState
  const worktree = captureWorktreeState(options.cwd)
  if (worktree.status === 'unknown' || worktree.hash === null)
    throw new Error('PBT agent worktree identity is unavailable')
  const stepId = randomUUID()
  const stepSourceRoot = join(options.sourceRoot, stepId)
  const repository = collectObservationProvenance({ cwd: options.cwd, env: {} }).repository
  const step = stepSchema.parse({
    schemaVersion: 1,
    stepId,
    sourceRoot: stepSourceRoot,
    cwd: options.cwd,
    repositorySha: repository.sha,
    repositoryBranch: repository.branch,
    agentRunId: options.agentRunId,
    worktreeState: worktree.status,
    worktreeStateHash: worktree.hash,
    ownerPid: process.pid
  })
  writeImmutableRecord(join(options.stagingRoot, 'steps'), stepId, step)
  const environment = {
    ...createAgentChildEnvironment(process.env),
    ...createRuntimeEnvironment(join(stepSourceRoot, 'runtime')),
    PBT_AGENT_RUN_ID: options.agentRunId,
    PBT_AGENT_STEP_ID: stepId,
    PBT_WORKTREE_STATE: worktree.status,
    PBT_WORKTREE_STATE_HASH: worktree.hash,
    PBT_SPOOL_DIR: stepSourceRoot
  }
  const exitCode = await (dependencies.runCommand ?? spawnCommand)(
    options.command,
    options.args,
    environment,
    options.cwd
  )
  const completedWorktree = captureWorktreeState(options.cwd)
  const finished = finishedStepSchema.parse({
    schemaVersion: 1,
    stepId,
    completedWorktreeStateHash: completedWorktree.hash,
    worktreeChanged:
      completedWorktree.status === 'unknown' || completedWorktree.hash !== worktree.hash
  })
  writeImmutableRecord(join(options.stagingRoot, 'finished'), stepId, finished)
  const captured = await captureStepEvidence(options, dependencies, step, finished)
  return { exitCode, stepId, ...captured }
}
