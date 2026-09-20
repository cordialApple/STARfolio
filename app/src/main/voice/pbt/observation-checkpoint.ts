import { createHash, randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'

const fileDigestSchema = z
  .object({
    path: z.string().regex(/^(?:raw|annotations)\/[^/\\]+$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()

const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    checkpointId: z.string().uuid(),
    sourceId: z.string().min(1),
    files: z.array(fileDigestSchema)
  })
  .strict()

export interface ObservationCheckpoint {
  checkpointId: string
  sourceId: string
  snapshotRoot: string
  files: Array<z.infer<typeof fileDigestSchema>>
}

export interface StageObservationCheckpointOptions {
  sourceRoot: string
  receiptRoot: string
  stagingRoot: string
  sourceId: string
  maxFiles?: number
  maxBytes?: number
}

interface SnapshotFile extends z.infer<typeof fileDigestSchema> {
  bytes: Buffer
}

function createCheckpointId(sourceId: string, files: SnapshotFile[]): string {
  const digest = createHash('sha256').update(sourceId).update('\0')
  for (const file of files) digest.update(file.path).update('\0').update(file.sha256).update('\0')
  const bytes = digest.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function readStableFile(path: string, remainingBytes: number): Buffer {
  const handle = openSync(path, 'r')
  try {
    const before = fstatSync(handle)
    if (!before.isFile()) throw new Error('PBT checkpoint source is not a file')
    if (before.size > remainingBytes) throw new Error('PBT checkpoint byte limit exceeded')
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      const count = readSync(handle, bytes, offset, bytes.byteLength - offset, offset)
      if (count === 0) break
      offset += count
    }
    const after = fstatSync(handle)
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('PBT checkpoint source changed during snapshot')
    return bytes
  } finally {
    closeSync(handle)
  }
}

function snapshotFiles(root: string, maxFiles: number, maxBytes: number): SnapshotFile[] {
  const files: SnapshotFile[] = []
  let usedBytes = 0
  for (const layer of ['raw', 'annotations'] as const) {
    const directory = join(root, layer)
    if (!existsSync(directory)) continue
    if (!lstatSync(directory).isDirectory())
      throw new Error(`PBT ${layer} layer is not a directory`)
    for (const name of readdirSync(directory).sort(compareText)) {
      if (files.length >= maxFiles) throw new Error('PBT checkpoint file limit exceeded')
      const absolutePath = join(directory, name)
      if (!lstatSync(absolutePath).isFile())
        throw new Error(`PBT checkpoint rejects non-file ${layer} entry`)
      const bytes = readStableFile(absolutePath, maxBytes - usedBytes)
      usedBytes += bytes.byteLength
      files.push({
        path: `${layer}/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes
      })
    }
  }
  return files
}

function readSeenDigests(root: string): Set<string> {
  const seen = new Set<string>()
  if (!existsSync(root)) return seen
  if (!lstatSync(root).isDirectory())
    throw new Error('PBT checkpoint receipt root is not a directory')
  for (const name of readdirSync(root).sort(compareText)) {
    const path = join(root, name)
    if (!lstatSync(path).isFile() || !name.endsWith('.json'))
      throw new Error(`PBT checkpoint receipt ${name} is invalid`)
    let receipt: z.infer<typeof receiptSchema>
    try {
      receipt = receiptSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      throw new Error(`PBT checkpoint receipt ${name} is malformed`)
    }
    if (name !== `${receipt.checkpointId}.json`)
      throw new Error(`PBT checkpoint receipt ${name} has mismatched identity`)
    for (const file of receipt.files) seen.add(`${receipt.sourceId}\0${file.path}\0${file.sha256}`)
  }
  return seen
}

function writeSnapshotFile(snapshotRoot: string, layer: string, name: string, bytes: Buffer): void {
  const directory = join(snapshotRoot, layer)
  const destination = join(directory, name)
  mkdirSync(directory, { recursive: true })
  const temporary = join(snapshotRoot, `.${layer}-${name}.${process.pid}.${randomUUID()}.tmp`)
  const handle = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(handle, bytes)
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  try {
    renameSync(temporary, destination)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    if (existsSync(destination) && readFileSync(destination).equals(bytes)) return
    throw error
  }
}

export function stageObservationCheckpoint(
  options: StageObservationCheckpointOptions
): ObservationCheckpoint {
  const maxFiles = options.maxFiles ?? 5_000
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024
  const seen = readSeenDigests(options.receiptRoot)
  const files = snapshotFiles(options.sourceRoot, maxFiles, maxBytes).filter(
    (file) => !seen.has(`${options.sourceId}\0${file.path}\0${file.sha256}`)
  )
  const checkpointId = createCheckpointId(options.sourceId, files)
  const snapshotRoot = join(options.stagingRoot, checkpointId)
  for (const file of files) {
    const [layer, name] = file.path.split('/') as ['raw' | 'annotations', string]
    writeSnapshotFile(snapshotRoot, layer, name, file.bytes)
  }
  return {
    checkpointId,
    sourceId: options.sourceId,
    snapshotRoot,
    files: files.map(({ path, sha256 }) => ({ path, sha256 }))
  }
}

export function commitObservationCheckpoint(
  receiptRoot: string,
  checkpoint: ObservationCheckpoint
): string {
  const receipt = receiptSchema.parse({
    schemaVersion: 1,
    checkpointId: checkpoint.checkpointId,
    sourceId: checkpoint.sourceId,
    files: checkpoint.files
  })
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`
  mkdirSync(receiptRoot, { recursive: true })
  const destination = join(receiptRoot, `${receipt.checkpointId}.json`)
  if (existsSync(destination)) {
    if (readFileSync(destination, 'utf8') !== bytes)
      throw new Error(`PBT checkpoint receipt ${receipt.checkpointId} already differs`)
    return destination
  }
  const temporary = join(
    dirname(receiptRoot),
    `.${receipt.checkpointId}.${process.pid}.${randomUUID()}.tmp`
  )
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
