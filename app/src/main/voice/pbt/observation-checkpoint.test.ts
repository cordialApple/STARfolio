import { createHash, randomUUID } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitObservationCheckpoint, stageObservationCheckpoint } from './observation-checkpoint'

function hash(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('PBT observation checkpoints', () => {
  let root: string
  let sourceRoot: string
  let receiptRoot: string
  let stagingRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'starfolio-pbt-checkpoint-'))
    sourceRoot = join(root, 'spool')
    receiptRoot = join(root, 'receipts')
    stagingRoot = join(root, 'staging')
    mkdirSync(join(sourceRoot, 'raw'), { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('stages unseen exact bytes until a durable receipt commits', () => {
    const eventId = randomUUID()
    const bytes = '{"partial":true'
    writeFileSync(join(sourceRoot, 'raw', `${eventId}.json`), bytes)

    const first = stageObservationCheckpoint({
      sourceRoot,
      receiptRoot,
      stagingRoot,
      sourceId: 'step-1'
    })
    const repeated = stageObservationCheckpoint({
      sourceRoot,
      receiptRoot,
      stagingRoot,
      sourceId: 'step-1'
    })

    expect(first.files).toEqual([{ path: `raw/${eventId}.json`, sha256: hash(bytes) }])
    expect(readFileSync(join(first.snapshotRoot, 'raw', `${eventId}.json`), 'utf8')).toBe(bytes)
    expect(repeated.files).toEqual(first.files)
    expect(repeated.checkpointId).toBe(first.checkpointId)
    expect(repeated.snapshotRoot).toBe(first.snapshotRoot)

    commitObservationCheckpoint(receiptRoot, first)

    expect(
      stageObservationCheckpoint({ sourceRoot, receiptRoot, stagingRoot, sourceId: 'step-1' }).files
    ).toEqual([])
  })

  it('restages a partial file when its exact bytes change', () => {
    const path = join(sourceRoot, 'raw', '.interrupted.tmp')
    writeFileSync(path, '{"schemaVersion":')
    const first = stageObservationCheckpoint({
      sourceRoot,
      receiptRoot,
      stagingRoot,
      sourceId: 'step-1'
    })
    commitObservationCheckpoint(receiptRoot, first)

    writeFileSync(path, '{"schemaVersion":2')
    const second = stageObservationCheckpoint({
      sourceRoot,
      receiptRoot,
      stagingRoot,
      sourceId: 'step-1'
    })

    expect(second.files).toEqual([
      { path: 'raw/.interrupted.tmp', sha256: hash('{"schemaVersion":2') }
    ])
  })

  it('rejects malformed receipts without hiding source evidence', () => {
    mkdirSync(receiptRoot, { recursive: true })
    writeFileSync(join(receiptRoot, 'broken.json'), '{not json')
    writeFileSync(join(sourceRoot, 'raw', `${randomUUID()}.json`), '{}')

    expect(() =>
      stageObservationCheckpoint({ sourceRoot, receiptRoot, stagingRoot, sourceId: 'step-1' })
    ).toThrow(/receipt/)
  })

  it('records one immutable receipt per checkpoint', () => {
    writeFileSync(join(sourceRoot, 'raw', `${randomUUID()}.json`), '{}')
    const checkpoint = stageObservationCheckpoint({
      sourceRoot,
      receiptRoot,
      stagingRoot,
      sourceId: 'step-1'
    })

    const receipt = commitObservationCheckpoint(receiptRoot, checkpoint)

    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual({
      schemaVersion: 1,
      checkpointId: checkpoint.checkpointId,
      sourceId: 'step-1',
      files: checkpoint.files
    })
    expect(() => commitObservationCheckpoint(receiptRoot, checkpoint)).not.toThrow()
  })
})
