/**
 * Backend-agnostic sync provider interface.
 *
 * A SyncProvider is a thin blob store that the sync engine drives. It owns
 * the wire format and auth specifics for one backend (Google Drive, WebDAV,
 * iCloud, encrypted file export, …) and exposes:
 *
 *   - get/setManifest        — the small JSON document tracking sessions + tombstones
 *   - list/read/write/delete — encrypted session blobs, keyed by session ID
 *   - get/setKeyData         — public encryption metadata (salt + verification hash)
 *                              used to detect a previously-paired account on reconnect
 *   - clearAll               — wipe everything this provider stores
 *
 * The interface deliberately does not surface any Drive-isms (file IDs,
 * folder IDs, MIME types, etc.). All blobs are addressed by session ID;
 * the provider is responsible for any internal naming/layout.
 *
 * Encryption stays above this layer — providers receive and return already-
 * encrypted EncryptedPayload objects and never see plaintext.
 */

import type { EncryptedPayload, SyncManifest } from '../types'

/**
 * Public encryption metadata that providers persist alongside session blobs
 * so a reinstalled client can detect an existing account before unlocking.
 * Intentionally a subset of EncryptionKeyData — recoveryPayload and the
 * iteration count stay local only.
 */
export interface ProviderKeyData {
  /** PBKDF2 salt (base64) */
  salt: string
  /** Verification hash to check password correctness */
  verificationHash: string
}

/**
 * Lightweight metadata about a stored session blob, returned by `list()`.
 * Exposes only what the engine and storage-info UI need; providers may
 * leave optional fields undefined if their backend does not surface them.
 */
export interface SyncObjectInfo {
  /** Session ID (without any provider-specific filename suffix) */
  id: string
  /** Encrypted blob size in bytes, if known */
  size?: number
  /** Last-modified time (epoch ms), if known */
  modifiedAt?: number
}

export interface SyncProvider {
  // Manifest: the engine's source of truth for what's in the cloud
  getManifest(): Promise<SyncManifest | null>
  setManifest(manifest: SyncManifest): Promise<void>

  // Encrypted session blobs, addressed by session ID
  list(): Promise<SyncObjectInfo[]>
  read(sessionId: string): Promise<EncryptedPayload | null>
  write(sessionId: string, data: EncryptedPayload): Promise<void>
  delete(sessionId: string): Promise<void>

  // Public encryption metadata for reconnect detection
  getKeyData(): Promise<ProviderKeyData | null>
  setKeyData(data: ProviderKeyData): Promise<void>

  // Wipe all of this provider's data (disconnect / recovery / reset)
  clearAll(): Promise<void>
}
