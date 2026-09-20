import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { lstatSync, readFileSync, readlinkSync } from 'fs'
import { resolve } from 'path'

export interface AgentWorktreeState {
  status: 'clean' | 'dirty' | 'unknown'
  hash: string | null
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function git(cwd: string, args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024
  })
}

export function captureAgentWorktreeState(cwd: string): AgentWorktreeState {
  try {
    const root = git(cwd, ['rev-parse', '--show-toplevel']).toString('utf8').trim()
    const head = git(root, ['rev-parse', 'HEAD'])
    const diff = git(root, [
      'diff',
      '--binary',
      '--full-index',
      '--no-ext-diff',
      '--no-textconv',
      'HEAD',
      '--'
    ])
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .sort(compareText)
    const identity = createHash('sha256')
    identity.update('head\0')
    identity.update(head)
    identity.update('\0diff\0')
    identity.update(diff)
    for (const path of untracked) {
      const absolutePath = resolve(root, path)
      const stat = lstatSync(absolutePath)
      const bytes = stat.isSymbolicLink()
        ? Buffer.from(readlinkSync(absolutePath), 'utf8')
        : readFileSync(absolutePath)
      identity.update('\0untracked\0')
      identity.update(path)
      identity.update('\0')
      identity.update(stat.isSymbolicLink() ? 'link\0' : 'file\0')
      identity.update(createHash('sha256').update(bytes).digest())
    }
    return {
      status: diff.byteLength === 0 && untracked.length === 0 ? 'clean' : 'dirty',
      hash: identity.digest('hex')
    }
  } catch {
    return { status: 'unknown', hash: null }
  }
}
