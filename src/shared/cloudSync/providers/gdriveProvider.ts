/**
 * SyncProvider adapter for Google Drive.
 *
 * Wraps the low-level Drive API client in `./gdrive.ts` to expose the
 * backend-agnostic SyncProvider contract. Calls dispatch through the
 * `gdrive` namespace import so that mocks installed via vi.mock on the
 * gdrive module are honoured by the adapter.
 */

import * as gdrive from './gdrive'
import type { SyncObjectInfo, SyncProvider } from './types'

/**
 * Strip the ".enc" suffix that uploadSession adds to map a Drive file name
 * back to its session ID. Files without the suffix (legacy or unexpected
 * entries in the sessions folder) are passed through unchanged.
 */
function fileNameToSessionId(name: string): string {
  return name.endsWith('.enc') ? name.slice(0, -'.enc'.length) : name
}

/**
 * Construct a SyncProvider bound to a specific Google Drive access token.
 *
 * Each call site that has just acquired (or refreshed) tokens should build
 * a fresh provider — providers are cheap closures, and this keeps token
 * lifetime management out of the interface.
 */
export function createGoogleDriveProvider(accessToken: string): SyncProvider {
  return {
    getManifest: () => gdrive.downloadManifest(accessToken),
    setManifest: (manifest) => gdrive.uploadManifest(accessToken, manifest),

    list: async (): Promise<SyncObjectInfo[]> => {
      const files = await gdrive.listSessionFiles(accessToken)
      return files.map((f) => ({
        id: fileNameToSessionId(f.name),
        size: f.size ? parseInt(f.size, 10) : undefined,
        modifiedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : undefined,
      }))
    },
    read: (sessionId) => gdrive.downloadSession(accessToken, sessionId),
    write: (sessionId, data) => gdrive.uploadSession(accessToken, sessionId, data),
    delete: (sessionId) => gdrive.deleteSession(accessToken, sessionId),

    getKeyData: () => gdrive.downloadKeyData(accessToken),
    setKeyData: (data) => gdrive.uploadKeyData(accessToken, data),

    clearAll: () => gdrive.clearAllData(accessToken),
  }
}
