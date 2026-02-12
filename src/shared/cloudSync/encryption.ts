/**
 * Client-side encryption for cloud sync
 *
 * Uses Web Crypto API:
 * - PBKDF2 for key derivation (100K iterations, SHA-256)
 * - AES-256-GCM for authenticated encryption
 * - Unique 96-bit IV per encryption operation
 */

import type { EncryptedPayload, EncryptionKeyData } from './types'

/** PBKDF2 iteration count - high for security, acceptable on modern devices */
const PBKDF2_ITERATIONS = 100_000

/** Salt length in bytes */
const SALT_LENGTH = 32

/** IV length in bytes (96 bits for AES-GCM) */
const IV_LENGTH = 12

/** Recovery key length in bytes */
const RECOVERY_KEY_LENGTH = 32

/**
 * Generate cryptographically random bytes
 */
function getRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

/**
 * Convert ArrayBuffer or Uint8Array to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBuffer(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Generate a random salt for PBKDF2
 */
export function generateSalt(): string {
  return bufferToBase64(getRandomBytes(SALT_LENGTH))
}

/**
 * Generate a random IV for AES-GCM
 */
export function generateIV(): string {
  return bufferToBase64(getRandomBytes(IV_LENGTH))
}

/**
 * Generate a recovery key (random bytes encoded as base64)
 * This is shown once to the user and can be used to recover access
 */
export function generateRecoveryKey(): string {
  const bytes = getRandomBytes(RECOVERY_KEY_LENGTH)
  // Format as groups of 4 characters separated by dashes for readability
  const base64 = bufferToBase64(bytes)
  return base64.replace(/(.{4})/g, '$1-').slice(0, -1)
}

/**
 * Derive an encryption key from a password using PBKDF2
 */
export async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const passwordBuffer = encoder.encode(password)
  const saltBuffer = base64ToBuffer(salt)

  // Import password as a key
  const passwordKey = await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])

  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt']
  )
}

/**
 * Derive a key from the recovery key (which is itself random entropy)
 */
export async function deriveKeyFromRecovery(recoveryKey: string, salt: string): Promise<CryptoKey> {
  // Remove dashes from formatted recovery key
  const cleanKey = recoveryKey.replace(/-/g, '')
  return deriveKey(cleanKey, salt)
}

/**
 * Create a verification hash to check if password is correct.
 * Uses AES-GCM with a fixed (zero) IV so the output is deterministic.
 * This is safe because: the plaintext is constant per salt, the key is unique
 * per password+salt, and the result is used for verification only.
 */
export async function createVerificationHash(key: CryptoKey, salt: string): Promise<string> {
  const plaintext = 'raft-verify-' + salt.slice(0, 8)
  const encoder = new TextEncoder()
  const fixedIv = new Uint8Array(12) // deterministic: same inputs → same output
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: fixedIv },
    key,
    encoder.encode(plaintext)
  )
  return bufferToBase64(ciphertext).slice(0, 32)
}

/**
 * Verify a password is correct by checking the verification hash
 */
export async function verifyPassword(
  password: string,
  keyData: EncryptionKeyData
): Promise<boolean> {
  try {
    const key = await deriveKey(password, keyData.salt)
    const hash = await createVerificationHash(key, keyData.salt)
    return hash === keyData.verificationHash
  } catch {
    return false
  }
}

/**
 * Encrypt data using AES-256-GCM
 */
export async function encrypt(data: string, key: CryptoKey): Promise<EncryptedPayload> {
  const encoder = new TextEncoder()
  const plaintext = encoder.encode(data)
  const iv = getRandomBytes(IV_LENGTH)

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  return {
    v: 1,
    iv: bufferToBase64(iv),
    ct: bufferToBase64(ciphertext),
  }
}

/**
 * Decrypt data using AES-256-GCM
 */
export async function decrypt(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
  if (payload.v !== 1) {
    throw new Error(`Unsupported encryption version: ${payload.v}`)
  }

  const iv = base64ToBuffer(payload.iv)
  const ciphertext = base64ToBuffer(payload.ct)

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)

  const decoder = new TextDecoder()
  return decoder.decode(plaintext)
}

/**
 * Encrypt an object (serializes to JSON first)
 */
export async function encryptObject<T>(data: T, key: CryptoKey): Promise<EncryptedPayload> {
  const json = JSON.stringify(data)
  return encrypt(json, key)
}

/**
 * Decrypt an object (parses JSON after decryption)
 */
export async function decryptObject<T>(payload: EncryptedPayload, key: CryptoKey): Promise<T> {
  const json = await decrypt(payload, key)
  return JSON.parse(json) as T
}

/**
 * Compute a checksum for change detection
 * Hashes the plaintext data so the checksum is stable across encryptions
 * (AES-GCM uses unique IVs, so ciphertext differs each time)
 */
export async function computeChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  return bufferToBase64(hashBuffer).slice(0, 16)
}

/**
 * Setup encryption for a new user
 * Returns the key data to store and the recovery key to show the user
 */
export async function setupEncryption(
  password: string
): Promise<{ keyData: EncryptionKeyData; recoveryKey: string; key: CryptoKey }> {
  const salt = generateSalt()
  const recoveryKey = generateRecoveryKey()
  const key = await deriveKey(password, salt)
  const verificationHash = await createVerificationHash(key, salt)

  return {
    keyData: {
      salt,
      verificationHash,
    },
    recoveryKey,
    key,
  }
}

/**
 * Re-encrypt data with a new password (for password change)
 */
export async function reEncrypt(
  payload: EncryptedPayload,
  oldKey: CryptoKey,
  newKey: CryptoKey
): Promise<EncryptedPayload> {
  const plaintext = await decrypt(payload, oldKey)
  return encrypt(plaintext, newKey)
}
