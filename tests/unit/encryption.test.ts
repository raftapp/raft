/**
 * Tests for client-side encryption
 *
 * Tests the cryptographic functions used for cloud sync encryption.
 * Uses Web Crypto API which is available in the jsdom test environment.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateSalt,
  generateIV,
  generateRecoveryKey,
  deriveKey,
  deriveKeyFromRecovery,
  createVerificationHash,
  verifyPassword,
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  computeChecksum,
  setupEncryption,
  reEncrypt,
} from '@/shared/cloudSync/encryption'
import type { EncryptedPayload, EncryptionKeyData } from '@/shared/cloudSync/types'

describe('generateSalt', () => {
  it('should generate a base64-encoded string', () => {
    const salt = generateSalt()
    expect(typeof salt).toBe('string')
    expect(salt.length).toBeGreaterThan(0)
    // Should be valid base64
    expect(() => atob(salt)).not.toThrow()
  })

  it('should generate unique salts on each call', () => {
    const salts = new Set<string>()
    for (let i = 0; i < 100; i++) {
      salts.add(generateSalt())
    }
    expect(salts.size).toBe(100)
  })

  it('should generate 32-byte salts (encoded as ~44 chars base64)', () => {
    const salt = generateSalt()
    const decoded = atob(salt)
    expect(decoded.length).toBe(32)
  })
})

describe('generateIV', () => {
  it('should generate a base64-encoded string', () => {
    const iv = generateIV()
    expect(typeof iv).toBe('string')
    expect(iv.length).toBeGreaterThan(0)
    expect(() => atob(iv)).not.toThrow()
  })

  it('should generate unique IVs on each call', () => {
    const ivs = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ivs.add(generateIV())
    }
    expect(ivs.size).toBe(100)
  })

  it('should generate 12-byte IVs (96 bits for AES-GCM)', () => {
    const iv = generateIV()
    const decoded = atob(iv)
    expect(decoded.length).toBe(12)
  })
})

describe('generateRecoveryKey', () => {
  it('should generate a formatted recovery key with dashes', () => {
    const key = generateRecoveryKey()
    expect(key).toMatch(/^[A-Za-z0-9+/]+-/)
    // Should have dashes every 4 characters
    const parts = key.split('-')
    // Most parts should be 4 chars (except possibly the last)
    for (let i = 0; i < parts.length - 1; i++) {
      expect(parts[i].length).toBe(4)
    }
  })

  it('should generate unique recovery keys', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 100; i++) {
      keys.add(generateRecoveryKey())
    }
    expect(keys.size).toBe(100)
  })

  it('should be derived from 32 bytes of entropy', () => {
    const key = generateRecoveryKey()
    // Remove dashes and decode
    const cleanKey = key.replace(/-/g, '')
    // 32 bytes = ~43 chars base64
    expect(cleanKey.length).toBeGreaterThanOrEqual(40)
  })
})

describe('deriveKey', () => {
  it('should derive a CryptoKey from password and salt', async () => {
    const salt = generateSalt()
    const key = await deriveKey('myPassword123', salt)

    expect(key).toBeDefined()
    expect(key.type).toBe('secret')
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM' })
    expect(key.usages).toContain('encrypt')
    expect(key.usages).toContain('decrypt')
  })

  it('should derive the same key for the same password and salt', async () => {
    const salt = generateSalt()
    const key1 = await deriveKey('myPassword123', salt)
    const key2 = await deriveKey('myPassword123', salt)

    // Can't compare CryptoKeys directly, so encrypt and compare
    const testData = 'test data'
    const encrypted1 = await encrypt(testData, key1)
    const decrypted = await decrypt(encrypted1, key2)
    expect(decrypted).toBe(testData)
  })

  it('should derive different keys for different passwords', async () => {
    const salt = generateSalt()
    const key1 = await deriveKey('password1', salt)
    const key2 = await deriveKey('password2', salt)

    const testData = 'test data'
    const encrypted = await encrypt(testData, key1)

    // Should fail to decrypt with different key
    await expect(decrypt(encrypted, key2)).rejects.toThrow()
  })

  it('should derive different keys for different salts', async () => {
    const salt1 = generateSalt()
    const salt2 = generateSalt()
    const key1 = await deriveKey('samePassword', salt1)
    const key2 = await deriveKey('samePassword', salt2)

    const testData = 'test data'
    const encrypted = await encrypt(testData, key1)

    // Should fail to decrypt with different key
    await expect(decrypt(encrypted, key2)).rejects.toThrow()
  })
})

describe('deriveKeyFromRecovery', () => {
  it('should derive a key from recovery key', async () => {
    const salt = generateSalt()
    const recoveryKey = generateRecoveryKey()
    const key = await deriveKeyFromRecovery(recoveryKey, salt)

    expect(key).toBeDefined()
    expect(key.type).toBe('secret')
  })

  it('should strip dashes from recovery key before derivation', async () => {
    const salt = generateSalt()
    const recoveryKey = generateRecoveryKey()
    const cleanKey = recoveryKey.replace(/-/g, '')

    // Both should produce the same key
    const key1 = await deriveKeyFromRecovery(recoveryKey, salt)
    const key2 = await deriveKey(cleanKey, salt)

    const testData = 'test'
    const encrypted = await encrypt(testData, key1)
    const decrypted = await decrypt(encrypted, key2)
    expect(decrypted).toBe(testData)
  })
})

describe('encrypt and decrypt', () => {
  let key: CryptoKey

  beforeEach(async () => {
    const salt = generateSalt()
    key = await deriveKey('testPassword', salt)
  })

  it('should encrypt and decrypt a string', async () => {
    const plaintext = 'Hello, World!'
    const encrypted = await encrypt(plaintext, key)
    const decrypted = await decrypt(encrypted, key)

    expect(decrypted).toBe(plaintext)
  })

  it('should return encrypted payload with correct structure', async () => {
    const encrypted = await encrypt('test', key)

    expect(encrypted).toHaveProperty('v', 1)
    expect(encrypted).toHaveProperty('iv')
    expect(encrypted).toHaveProperty('ct')
    expect(typeof encrypted.iv).toBe('string')
    expect(typeof encrypted.ct).toBe('string')
  })

  it('should generate unique IVs for each encryption', async () => {
    const plaintext = 'same text'
    const encrypted1 = await encrypt(plaintext, key)
    const encrypted2 = await encrypt(plaintext, key)

    expect(encrypted1.iv).not.toBe(encrypted2.iv)
    expect(encrypted1.ct).not.toBe(encrypted2.ct)
  })

  it('should handle empty string', async () => {
    const encrypted = await encrypt('', key)
    const decrypted = await decrypt(encrypted, key)
    expect(decrypted).toBe('')
  })

  it('should handle unicode characters', async () => {
    const plaintext = '日本語 emoji: 🎉🔐 symbols: äöü'
    const encrypted = await encrypt(plaintext, key)
    const decrypted = await decrypt(encrypted, key)
    expect(decrypted).toBe(plaintext)
  })

  it('should handle large strings', async () => {
    const plaintext = 'x'.repeat(100000)
    const encrypted = await encrypt(plaintext, key)
    const decrypted = await decrypt(encrypted, key)
    expect(decrypted).toBe(plaintext)
  })

  it('should reject unsupported version', async () => {
    const encrypted = await encrypt('test', key)
    const badPayload: EncryptedPayload = { ...encrypted, v: 2 as 1 }

    await expect(decrypt(badPayload, key)).rejects.toThrow('Unsupported encryption version')
  })

  it('should reject tampered ciphertext', async () => {
    const encrypted = await encrypt('test', key)
    const tamperedCt = 'AAAA' + encrypted.ct.slice(4)
    const tampered: EncryptedPayload = { ...encrypted, ct: tamperedCt }

    // AES-GCM should detect tampering
    await expect(decrypt(tampered, key)).rejects.toThrow()
  })

  it('should reject wrong key', async () => {
    const salt = generateSalt()
    const wrongKey = await deriveKey('wrongPassword', salt)
    const encrypted = await encrypt('test', key)

    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow()
  })
})

describe('encryptObject and decryptObject', () => {
  let key: CryptoKey

  beforeEach(async () => {
    const salt = generateSalt()
    key = await deriveKey('testPassword', salt)
  })

  it('should encrypt and decrypt an object', async () => {
    const obj = { name: 'test', count: 42, nested: { value: true } }
    const encrypted = await encryptObject(obj, key)
    const decrypted = await decryptObject<typeof obj>(encrypted, key)

    expect(decrypted).toEqual(obj)
  })

  it('should encrypt and decrypt an array', async () => {
    const arr = [1, 2, 3, 'test', { key: 'value' }]
    const encrypted = await encryptObject(arr, key)
    const decrypted = await decryptObject<typeof arr>(encrypted, key)

    expect(decrypted).toEqual(arr)
  })

  it('should handle null', async () => {
    const encrypted = await encryptObject(null, key)
    const decrypted = await decryptObject<null>(encrypted, key)
    expect(decrypted).toBeNull()
  })

  it('should preserve complex nested structures', async () => {
    const complex = {
      id: 'session-123',
      windows: [
        {
          tabs: [
            { url: 'https://example.com', title: 'Example' },
            { url: 'https://test.com', title: 'Test' },
          ],
        },
      ],
      metadata: {
        created: Date.now(),
        tags: ['tag1', 'tag2'],
      },
    }

    const encrypted = await encryptObject(complex, key)
    const decrypted = await decryptObject<typeof complex>(encrypted, key)

    expect(decrypted).toEqual(complex)
  })
})

describe('computeChecksum', () => {
  it('should return a 16-character hash of plaintext data', async () => {
    const checksum = await computeChecksum('test data')

    expect(checksum.length).toBe(16)
    expect(typeof checksum).toBe('string')
  })

  it('should be stable for the same plaintext', async () => {
    const checksum1 = await computeChecksum('test data')
    const checksum2 = await computeChecksum('test data')

    expect(checksum1).toBe(checksum2)
  })

  it('should be different for different plaintext', async () => {
    const checksum1 = await computeChecksum('data1')
    const checksum2 = await computeChecksum('data2')

    expect(checksum1).not.toBe(checksum2)
  })
})

describe('createVerificationHash', () => {
  it('should create a verification hash', async () => {
    const salt = generateSalt()
    const key = await deriveKey('test', salt)
    const hash = await createVerificationHash(key, salt)

    expect(typeof hash).toBe('string')
    expect(hash.length).toBe(32)
  })

  it('should be deterministic for same key and salt', async () => {
    const salt = generateSalt()
    const key = await deriveKey('test', salt)

    const hash1 = await createVerificationHash(key, salt)
    const hash2 = await createVerificationHash(key, salt)

    expect(hash1).toBe(hash2)
  })

  it('should differ for different passwords', async () => {
    const salt = generateSalt()
    const key1 = await deriveKey('password1', salt)
    const key2 = await deriveKey('password2', salt)

    const hash1 = await createVerificationHash(key1, salt)
    const hash2 = await createVerificationHash(key2, salt)

    expect(hash1).not.toBe(hash2)
  })
})

describe('verifyPassword', () => {
  it('should return true for correct password', async () => {
    const { keyData } = await setupEncryption('correctPassword')

    const result = await verifyPassword('correctPassword', keyData)
    expect(result).toBe(true)
  })

  it('should return false for incorrect password', async () => {
    const { keyData } = await setupEncryption('correctPassword')

    const result = await verifyPassword('wrongPassword', keyData)
    expect(result).toBe(false)
  })

  it('should handle invalid key data gracefully', async () => {
    const keyData: EncryptionKeyData = {
      salt: 'invalid',
      verificationHash: 'invalid',
    }

    const result = await verifyPassword('anyPassword', keyData)
    expect(result).toBe(false)
  })
})

describe('setupEncryption', () => {
  it('should return key data, recovery key, and derived key', async () => {
    const result = await setupEncryption('mySecurePassword')

    expect(result).toHaveProperty('keyData')
    expect(result).toHaveProperty('recoveryKey')
    expect(result).toHaveProperty('key')

    expect(result.keyData.salt).toBeDefined()
    expect(result.keyData.verificationHash).toBeDefined()
    // recoveryKey is NOT stored in keyData (security fix: never persisted)
    expect(result.keyData).not.toHaveProperty('recoveryKey')
    expect(result.recoveryKey).toContain('-')
    expect(result.key.type).toBe('secret')
  })

  it('should allow encryption with the returned key', async () => {
    const { key } = await setupEncryption('myPassword')

    const testData = 'test encryption'
    const encrypted = await encrypt(testData, key)
    const decrypted = await decrypt(encrypted, key)

    expect(decrypted).toBe(testData)
  })

  it('should produce a deterministic verification hash', async () => {
    const { keyData, key } = await setupEncryption('myPasswordForVerification')

    // Recomputing the hash with the same key and salt should match
    const recomputed = await createVerificationHash(key, keyData.salt)
    expect(recomputed).toBe(keyData.verificationHash)
  })
})

describe('reEncrypt', () => {
  it('should re-encrypt data with a new key', async () => {
    const salt1 = generateSalt()
    const salt2 = generateSalt()
    const oldKey = await deriveKey('oldPassword', salt1)
    const newKey = await deriveKey('newPassword', salt2)

    const plaintext = 'sensitive data'
    const originalEncrypted = await encrypt(plaintext, oldKey)

    const reencrypted = await reEncrypt(originalEncrypted, oldKey, newKey)

    // Should not decrypt with old key
    await expect(decrypt(reencrypted, oldKey)).rejects.toThrow()

    // Should decrypt with new key
    const decrypted = await decrypt(reencrypted, newKey)
    expect(decrypted).toBe(plaintext)
  })

  it('should preserve the original data exactly', async () => {
    const salt1 = generateSalt()
    const salt2 = generateSalt()
    const oldKey = await deriveKey('old', salt1)
    const newKey = await deriveKey('new', salt2)

    const complex = {
      id: '123',
      data: { nested: true },
      unicode: '日本語 🎉',
    }

    const originalEncrypted = await encryptObject(complex, oldKey)
    const reencrypted = await reEncrypt(originalEncrypted, oldKey, newKey)
    const decrypted = await decryptObject<typeof complex>(reencrypted, newKey)

    expect(decrypted).toEqual(complex)
  })

  it('should fail if old key is wrong', async () => {
    const salt = generateSalt()
    const correctKey = await deriveKey('correct', salt)
    const wrongKey = await deriveKey('wrong', salt)
    const newKey = await deriveKey('new', salt)

    const encrypted = await encrypt('test', correctKey)

    await expect(reEncrypt(encrypted, wrongKey, newKey)).rejects.toThrow()
  })
})
