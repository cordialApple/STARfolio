import { execFileSync, spawnSync } from 'child_process'
import { randomUUID } from 'crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface AppendDurableObservationCycleOptions {
  workspaceRoot: string
  remoteUrl: string
  cycleDirectory: string
  runId: string
  runAttempt: string
  attempts?: number
  retryDelayMs?: number
  beforePush?: (attempt: number) => Promise<void>
}

function assertSegment(label: string, value: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Invalid PBT ${label}`)
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function tryGit(cwd: string, args: string[]): boolean {
  return spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0
}

function listFiles(root: string, prefix = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(root, relative))
    else if (entry.isFile()) files.push(relative)
    else throw new Error('PBT retained cycle contains a non-file entry')
  }
  return files.sort()
}

function directoriesEqual(left: string, right: string): boolean {
  const leftFiles = listFiles(left)
  const rightFiles = listFiles(right)
  return (
    leftFiles.length === rightFiles.length &&
    leftFiles.every(
      (file, index) =>
        file === rightFiles[index] &&
        readFileSync(join(left, file)).equals(readFileSync(join(right, file)))
    )
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function appendDurableObservationCycle(
  options: AppendDurableObservationCycleOptions
): Promise<void> {
  assertSegment('run id', options.runId)
  assertSegment('run attempt', options.runAttempt)
  if (!existsSync(options.cycleDirectory)) throw new Error('PBT validated cycle is missing')
  const attempts = options.attempts ?? 5
  const retryDelayMs = options.retryDelayMs ?? 1_000
  mkdirSync(options.workspaceRoot, { recursive: true })
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const repository = join(
      options.workspaceRoot,
      `attempt-${attempt}-${process.pid}-${randomUUID()}`
    )
    mkdirSync(repository)
    try {
      git(repository, ['init'])
      git(repository, ['config', 'core.autocrlf', 'false'])
      git(repository, ['config', 'core.safecrlf', 'false'])
      git(repository, ['remote', 'add', 'origin', options.remoteUrl])
      if (process.env.GIT_AUTH_TOKEN) {
        git(repository, [
          'config',
          'credential.helper',
          '!f() { if [ "$1" = get ]; then printf "username=x-access-token\\npassword=%s\\n" "$GIT_AUTH_TOKEN"; fi; }; f'
        ])
      }
      tryGit(repository, [
        'fetch',
        'origin',
        '+refs/heads/pbt-observations:refs/remotes/origin/pbt-observations'
      ])
      const hasRemote = tryGit(repository, [
        'show-ref',
        '--verify',
        '--quiet',
        'refs/remotes/origin/pbt-observations'
      ])
      if (hasRemote) git(repository, ['switch', '--detach', 'refs/remotes/origin/pbt-observations'])
      else {
        git(repository, [
          'switch',
          '--orphan',
          `pbt-retention-${options.runId}-${options.runAttempt}`
        ])
        writeFileSync(
          join(repository, 'README.md'),
          '# STARfolio PBT observations\n\nAppend-only trusted CI cycles. Never merge this branch into main.\n'
        )
        git(repository, ['add', 'README.md'])
      }
      const target = join(repository, 'cycles', options.runId, options.runAttempt)
      if (existsSync(target)) {
        if (!directoriesEqual(target, options.cycleDirectory))
          throw new Error(`PBT cycle ${options.runId}-${options.runAttempt} already differs`)
        return
      }
      mkdirSync(dirname(target), { recursive: true })
      cpSync(options.cycleDirectory, target, { recursive: true, errorOnExist: true })
      git(repository, ['add', target])
      git(repository, [
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit',
        '-m',
        `chore(pbt): retain cycle ${options.runId}-${options.runAttempt}`
      ])
      await options.beforePush?.(attempt)
      if (tryGit(repository, ['push', 'origin', 'HEAD:pbt-observations'])) return
      lastError = new Error('PBT durable cycle push failed')
    } catch (error) {
      lastError = error
      if (error instanceof Error && error.message.includes('already differs')) throw error
    }
    if (attempt < attempts) await delay(retryDelayMs * attempt)
  }
  throw lastError ?? new Error('PBT durable cycle append failed')
}
