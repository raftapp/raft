/**
 * Client-side encryption for cloud sync
 *
 * Uses Web Crypto API:
 * - PBKDF2 for key derivation (600K iterations, SHA-256; legacy data uses 100K)
 * - AES-256-GCM for authenticated encryption
 * - Unique 96-bit IV per encryption operation
 */

import type { EncryptedPayload, EncryptionKeyData } from './types'

/**
 * PBKDF2 iteration count for new key derivations.
 *
 * 600_000 matches OWASP's 2023+ recommendation for PBKDF2-SHA256. On modern
 * hardware this is ~400–700 ms for a single derivation, which we accept
 * because unlock happens at most once per cached-key lifetime.
 *
 * Existing installs that predate this bump store no `iterations` field on
 * their `EncryptionKeyData` — callers MUST fall back to
 * LEGACY_PBKDF2_ITERATIONS for those records so they continue to unlock.
 */
export const PBKDF2_ITERATIONS = 600_000

/**
 * Iteration count used before the bump to 600K. Kept here (and exported) so
 * the unlock path can default missing `keyData.iterations` to the original
 * value rather than silently failing verification.
 */
export const LEGACY_PBKDF2_ITERATIONS = 100_000

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
 * Derive an encryption key from a password using PBKDF2.
 *
 * `iterations` defaults to PBKDF2_ITERATIONS (current standard). Legacy
 * unlock paths must pass `keyData.iterations ?? LEGACY_PBKDF2_ITERATIONS`
 * so pre-600k records still derive the correct key.
 */
export async function deriveKey(
  password: string,
  salt: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
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
      iterations,
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
export async function deriveKeyFromRecovery(
  recoveryKey: string,
  salt: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  // Remove dashes from formatted recovery key
  const cleanKey = recoveryKey.replace(/-/g, '')
  return deriveKey(cleanKey, salt, iterations)
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
 * Verify a password is correct by checking the verification hash.
 * Uses `keyData.iterations` if present, falling back to LEGACY_PBKDF2_ITERATIONS
 * so records written before the 600k bump still verify.
 */
export async function verifyPassword(
  password: string,
  keyData: EncryptionKeyData
): Promise<boolean> {
  try {
    const iterations = keyData.iterations ?? LEGACY_PBKDF2_ITERATIONS
    const key = await deriveKey(password, keyData.salt, iterations)
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
 * Setup encryption for a new user.
 * Writes `iterations: PBKDF2_ITERATIONS` into keyData so this install is
 * tagged with the current (strong) count and never falls back to legacy.
 */
export async function setupEncryption(
  password: string
): Promise<{ keyData: EncryptionKeyData; recoveryKey: string; key: CryptoKey }> {
  const salt = generateSalt()
  const recoveryKey = generateRecoveryKey()
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const verificationHash = await createVerificationHash(key, salt)

  return {
    keyData: {
      salt,
      verificationHash,
      iterations: PBKDF2_ITERATIONS,
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
