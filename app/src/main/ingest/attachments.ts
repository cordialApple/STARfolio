import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, extname } from 'path'

export interface StoredAttachment {
  hash: string
  attachmentPath: string
}

export function attachmentsDir(): string {
  const dir = join(app.getPath('userData'), 'attachments')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function storeAttachment(bytes: Uint8Array, originalName: string): StoredAttachment {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const ext = extname(originalName).toLowerCase()
  const attachmentPath = join(attachmentsDir(), `${hash}${ext}`)
  if (!existsSync(attachmentPath)) writeFileSync(attachmentPath, bytes)
  return { hash, attachmentPath }
}
