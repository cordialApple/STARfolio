import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { getDb, initDb } from '../../src/main/db/client'
import { deleteSecret, getSecret, hasSecret, setSecret } from '../../src/main/settings/secrets'

beforeEach(() => {
  initDb(':memory:')
})
afterEach(() => vi.restoreAllMocks())

function withEncryption(): void {
  vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true)
}

describe('secrets guard', () => {
  it('refuses to store a secret when OS secure storage is unavailable', () => {
    expect(() => setSecret('anthropic_api_key', 'sk-live')).toThrow('secure storage')
  })

  it('returns null for a missing key without needing encryption', () => {
    expect(getSecret('anthropic_api_key')).toBeNull()
  })
})

describe('secrets round-trip', () => {
  beforeEach(withEncryption)

  it('encrypts on write and decrypts on read', () => {
    setSecret('anthropic_api_key', 'sk-live-123')
    expect(getSecret('anthropic_api_key')).toBe('sk-live-123')
  })

  it('does not persist the plaintext value', () => {
    setSecret('anthropic_api_key', 'sk-live-123')
    const row = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('anthropic_api_key') as { value: string }
    expect(row.value).not.toBe('sk-live-123')
  })

  it('overwrites an existing secret in place', () => {
    setSecret('anthropic_api_key', 'first')
    setSecret('anthropic_api_key', 'second')
    expect(getSecret('anthropic_api_key')).toBe('second')
  })
})

describe('hasSecret / deleteSecret', () => {
  beforeEach(withEncryption)

  it('reports presence and clears on delete', () => {
    expect(hasSecret('anthropic_api_key')).toBe(false)
    setSecret('anthropic_api_key', 'sk')
    expect(hasSecret('anthropic_api_key')).toBe(true)
    deleteSecret('anthropic_api_key')
    expect(hasSecret('anthropic_api_key')).toBe(false)
    expect(getSecret('anthropic_api_key')).toBeNull()
  })
})
