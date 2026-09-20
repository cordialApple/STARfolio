import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureAgentWorktreeState } from './agent-worktree'

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

describe('agent worktree identity', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'starfolio-agent-state-'))
    git(root, ['init'])
    git(root, ['config', 'user.name', 'test'])
    git(root, ['config', 'user.email', 'test@example.com'])
    writeFileSync(join(root, 'tracked.txt'), 'one\n')
    git(root, ['add', 'tracked.txt'])
    git(root, ['commit', '-m', 'test: seed'])
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('produces a stable clean identity', () => {
    const first = captureAgentWorktreeState(root)
    const second = captureAgentWorktreeState(root)

    expect(first).toEqual(second)
    expect(first.status).toBe('clean')
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes identity for tracked and untracked content', () => {
    const clean = captureAgentWorktreeState(root)
    writeFileSync(join(root, 'tracked.txt'), 'two\n')
    const tracked = captureAgentWorktreeState(root)
    writeFileSync(join(root, 'new.txt'), 'three\n')
    const untracked = captureAgentWorktreeState(root)
    writeFileSync(join(root, 'new.txt'), 'four\n')
    const changedUntracked = captureAgentWorktreeState(root)

    expect(tracked.status).toBe('dirty')
    expect(new Set([clean.hash, tracked.hash, untracked.hash, changedUntracked.hash])).toHaveLength(4)
  })

  it('returns explicit unknown values outside Git', () => {
    const outside = mkdtempSync(join(tmpdir(), 'starfolio-agent-state-none-'))
    try {
      expect(captureAgentWorktreeState(outside)).toEqual({ status: 'unknown', hash: null })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
