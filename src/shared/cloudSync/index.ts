/**
 * Cloud sync module public API
 */

// Types
export type {
  CloudProvider,
  CloudTokens,
  CloudCredentials,
  EncryptionKeyData,
  EncryptedPayload,
  SyncManifest,
  SyncSessionMeta,
  SyncTombstone,
  SyncQueueItem,
  SyncState,
  CloudSyncSettings,
  SyncResult,
  CloudSessionData,
} from './types'

export { DEFAULT_CLOUD_SYNC_SETTINGS } from './types'

// Encryption
export {
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
} from './encryption'

// Storage
export {
  cloudCredentialsStorage,
  encryptionKeyStorage,
  syncQueueStorage,
  syncStateStorage,
  cloudSyncSettingsStorage,
  deviceIdStorage,
  clearAllCloudSyncData,
} from './storage'

// OAuth
export {
  launchGoogleOAuth,
  refreshAccessToken,
  revokeAccess,
  tokensNeedRefresh,
  getValidTokens,
} from './oauth'
export type { OAuthResult } from './oauth'

// Google Drive provider
export * as gdrive from './providers/gdrive'

// Sync queue
export * as syncQueue from './syncQueue'

// Sync engine
export * as syncEngine from './syncEngine'
