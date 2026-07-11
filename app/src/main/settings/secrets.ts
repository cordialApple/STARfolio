import { safeStorage } from 'electron'
import { getDb } from '../db/client'

function assertEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage (safeStorage) is unavailable — cannot store secrets')
  }
}

export function setSecret(key: string, value: string): void {
  assertEncryption()
  const db = getDb()
  const encrypted = safeStorage.encryptString(value)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    key,
    encrypted.toString('base64')
  )
}

export function getSecret(key: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return null
  assertEncryption()
  const buf = Buffer.from(row.value, 'base64')
  return safeStorage.decryptString(buf)
}

export function hasSecret(key: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key)
  return row != null
}

export function deleteSecret(key: string): void {
  const db = getDb()
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}
