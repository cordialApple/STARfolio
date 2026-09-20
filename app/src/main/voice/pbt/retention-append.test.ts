import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendDurableObservationCycle } from './retention-append'

describe('PBT durable cycle append', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'starfolio-pbt-retain-'))
  })

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    } catch {
      return
    }
  })

  it('creates an orphan branch and keeps retries idempotent', async () => {
    const remote = join(root, 'remote.git')
    const cycle = join(root, 'cycle')
    mkdirSync(cycle)
    writeFileSync(join(cycle, 'manifest.json'), '{"cycleId":"101-2"}\n')
    writeFileSync(join(cycle, 'payload.enc'), Buffer.from([0, 1, 2, 3]))
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })

    const options = {
      workspaceRoot: join(root, 'work'),
      remoteUrl: remote,
      cycleDirectory: cycle,
      runId: '101',
      runAttempt: '2',
      attempts: 2,
      retryDelayMs: 0
    }
    await appendDurableObservationCycle(options)
    await appendDurableObservationCycle(options)

    expect(
      execFileSync(
        'git',
        ['--git-dir', remote, 'show', 'pbt-observations:cycles/101/2/manifest.json'],
        { encoding: 'utf8' }
      )
    ).toBe('{"cycleId":"101-2"}\n')
    expect(
      execFileSync('git', ['--git-dir', remote, 'rev-list', '--count', 'pbt-observations'], {
        encoding: 'utf8'
      }).trim()
    ).toBe('1')
  })

  it('retries a concurrent non-fast-forward and preserves both cycles', async () => {
    const remote = join(root, 'remote.git')
    const firstCycle = join(root, 'cycle-201')
    const secondCycle = join(root, 'cycle-202')
    mkdirSync(firstCycle)
    mkdirSync(secondCycle)
    writeFileSync(join(firstCycle, 'manifest.json'), '{"cycleId":"201-1"}\n')
    writeFileSync(join(firstCycle, 'payload.enc'), Buffer.from([1]))
    writeFileSync(join(secondCycle, 'manifest.json'), '{"cycleId":"202-1"}\n')
    writeFileSync(join(secondCycle, 'payload.enc'), Buffer.from([2]))
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })

    let arrivals = 0
    let releaseFirstPush: () => void = () => undefined
    const firstPushReady = new Promise<void>((resolve) => {
      releaseFirstPush = resolve
    })
    const beforePush = async (attempt: number): Promise<void> => {
      if (attempt !== 1) return
      arrivals += 1
      if (arrivals === 2) releaseFirstPush()
      await firstPushReady
    }

    await Promise.all([
      appendDurableObservationCycle({
        workspaceRoot: join(root, 'work-201'),
        remoteUrl: remote,
        cycleDirectory: firstCycle,
        runId: '201',
        runAttempt: '1',
        attempts: 3,
        retryDelayMs: 0,
        beforePush
      }),
      appendDurableObservationCycle({
        workspaceRoot: join(root, 'work-202'),
        remoteUrl: remote,
        cycleDirectory: secondCycle,
        runId: '202',
        runAttempt: '1',
        attempts: 3,
        retryDelayMs: 0,
        beforePush
      })
    ])

    expect(arrivals).toBe(2)
    expect(
      execFileSync(
        'git',
        ['--git-dir', remote, 'show', 'pbt-observations:cycles/201/1/manifest.json'],
        { encoding: 'utf8' }
      )
    ).toBe('{"cycleId":"201-1"}\n')
    expect(
      execFileSync(
        'git',
        ['--git-dir', remote, 'show', 'pbt-observations:cycles/202/1/manifest.json'],
        { encoding: 'utf8' }
      )
    ).toBe('{"cycleId":"202-1"}\n')
  }, 15_000)
})
