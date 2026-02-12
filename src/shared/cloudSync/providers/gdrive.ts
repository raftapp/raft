/**
 * Google Drive API wrapper for cloud sync
 *
 * Uses the App Data folder which is:
 * - Hidden from the user's Drive UI
 * - Only accessible by this application
 * - Doesn't count against user's quota
 */

import { GDRIVE_API } from '../../constants'
import type { EncryptedPayload, SyncManifest } from '../types'

/**
 * Google Drive file metadata
 */
interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
}

/**
 * List files response
 */
interface ListFilesResponse {
  files: DriveFile[]
  nextPageToken?: string
}

/**
 * Make an authenticated request to Google Drive API
 */
/**
 * Error class for Drive API errors with HTTP status codes
 */
export class DriveApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'DriveApiError'
  }
}

async function driveRequest<T>(
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${GDRIVE_API.BASE_URL}${endpoint}`

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorBody = await response
      .json()
      .catch(() => ({ error: { message: response.statusText } }))
    const reason = errorBody.error?.errors?.[0]?.reason
    const message = errorBody.error?.message || response.statusText

    switch (response.status) {
      case 401:
        throw new DriveApiError('Authentication expired — please reconnect', 401)
      case 403:
        if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          throw new DriveApiError('Rate limited — will retry automatically', 403)
        }
        throw new DriveApiError(`Access denied: ${message}`, 403)
      case 413:
        throw new DriveApiError('Session too large for cloud sync', 413)
      case 507:
        throw new DriveApiError('Google Drive storage full', 507)
      default:
        throw new DriveApiError(`Drive API error: ${message}`, response.status)
    }
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

/**
 * Create the sessions folder in App Data if it doesn't exist
 */
async function ensureSessionsFolder(accessToken: string): Promise<string> {
  // Check if folder already exists
  const existingFolder = await findFile(accessToken, GDRIVE_API.SESSIONS_FOLDER, 'folder')
  if (existingFolder) {
    return existingFolder.id
  }

  // Create the folder
  const metadata = {
    name: GDRIVE_API.SESSIONS_FOLDER,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [GDRIVE_API.APP_DATA_FOLDER],
  }

  const response = await driveRequest<DriveFile>(accessToken, '/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  })

  return response.id
}

/**
 * Find a file by name in App Data
 */
async function findFile(
  accessToken: string,
  name: string,
  type?: 'file' | 'folder'
): Promise<DriveFile | null> {
  let query = `name = '${name}' and '${GDRIVE_API.APP_DATA_FOLDER}' in parents and trashed = false`
  if (type === 'folder') {
    query += ` and mimeType = 'application/vnd.google-apps.folder'`
  } else if (type === 'file') {
    query += ` and mimeType != 'application/vnd.google-apps.folder'`
  }

  const response = await driveRequest<ListFilesResponse>(
    accessToken,
    `/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime)`
  )

  return response.files[0] || null
}

/**
 * Find a file in the sessions folder
 */
async function findSessionFile(accessToken: string, sessionId: string): Promise<DriveFile | null> {
  const folder = await findFile(accessToken, GDRIVE_API.SESSIONS_FOLDER, 'folder')
  if (!folder) {
    return null
  }

  const fileName = `${sessionId}.enc`
  const query = `name = '${fileName}' and '${folder.id}' in parents and trashed = false`

  const response = await driveRequest<ListFilesResponse>(
    accessToken,
    `/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime)`
  )

  return response.files[0] || null
}

/**
 * Upload a file to Google Drive (create or update)
 */
export async function uploadFile(
  accessToken: string,
  fileName: string,
  content: string,
  parentId?: string
): Promise<string> {
  const parent = parentId || GDRIVE_API.APP_DATA_FOLDER

  // Check if file exists
  let query = `name = '${fileName}' and '${parent}' in parents and trashed = false`
  const existingResponse = await driveRequest<ListFilesResponse>(
    accessToken,
    `/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id)`
  )

  const existingFile = existingResponse.files[0]

  if (existingFile) {
    // Update existing file
    await fetch(`${GDRIVE_API.UPLOAD_URL}/files/${existingFile.id}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: content,
    })
    return existingFile.id
  } else {
    // Create new file with multipart upload
    const metadata = {
      name: fileName,
      parents: [parent],
    }

    const boundary = '-------RaftBoundary' + Date.now()
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`

    const response = await fetch(
      `${GDRIVE_API.UPLOAD_URL}/files?uploadType=multipart&spaces=appDataFolder`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    )

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`)
    }

    const data = await response.json()
    return data.id
  }
}

/**
 * Download a file from Google Drive
 */
export async function downloadFile(accessToken: string, fileId: string): Promise<string> {
  const response = await fetch(`${GDRIVE_API.BASE_URL}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`)
  }

  return response.text()
}

/**
 * Delete a file from Google Drive
 */
export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  await driveRequest(accessToken, `/files/${fileId}`, {
    method: 'DELETE',
  })
}

/**
 * List all session files
 */
export async function listSessionFiles(accessToken: string): Promise<DriveFile[]> {
  const folder = await findFile(accessToken, GDRIVE_API.SESSIONS_FOLDER, 'folder')
  if (!folder) {
    return []
  }

  const query = `'${folder.id}' in parents and trashed = false`
  const response = await driveRequest<ListFilesResponse>(
    accessToken,
    `/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,size)`
  )

  return response.files
}

// ============================================================================
// High-level operations for Raft sync
// ============================================================================

/**
 * Upload the sync manifest
 */
export async function uploadManifest(accessToken: string, manifest: SyncManifest): Promise<void> {
  const content = JSON.stringify(manifest)
  await uploadFile(accessToken, GDRIVE_API.MANIFEST_FILE, content)
}

/**
 * Download the sync manifest
 */
export async function downloadManifest(accessToken: string): Promise<SyncManifest | null> {
  const file = await findFile(accessToken, GDRIVE_API.MANIFEST_FILE)
  if (!file) {
    return null
  }

  const content = await downloadFile(accessToken, file.id)
  return JSON.parse(content)
}

/**
 * Key data stored on Drive (subset of EncryptionKeyData — no recoveryPayload)
 */
interface DriveKeyData {
  salt: string
  verificationHash: string
}

/**
 * Upload key data (salt + verification hash) to Drive for reconnect detection
 */
export async function uploadKeyData(accessToken: string, keyData: DriveKeyData): Promise<void> {
  const content = JSON.stringify(keyData)
  await uploadFile(accessToken, GDRIVE_API.KEYDATA_FILE, content)
}

/**
 * Download key data from Drive, returns null if not found
 */
export async function downloadKeyData(accessToken: string): Promise<DriveKeyData | null> {
  const file = await findFile(accessToken, GDRIVE_API.KEYDATA_FILE)
  if (!file) {
    return null
  }

  const content = await downloadFile(accessToken, file.id)
  return JSON.parse(content)
}

/**
 * Upload an encrypted session
 */
export async function uploadSession(
  accessToken: string,
  sessionId: string,
  encryptedData: EncryptedPayload
): Promise<void> {
  const folderId = await ensureSessionsFolder(accessToken)
  const fileName = `${sessionId}.enc`
  const content = JSON.stringify(encryptedData)
  await uploadFile(accessToken, fileName, content, folderId)
}

/**
 * Download an encrypted session
 */
export async function downloadSession(
  accessToken: string,
  sessionId: string
): Promise<EncryptedPayload | null> {
  const file = await findSessionFile(accessToken, sessionId)
  if (!file) {
    return null
  }

  const content = await downloadFile(accessToken, file.id)
  return JSON.parse(content)
}

/**
 * Delete a session from cloud storage
 */
export async function deleteSession(accessToken: string, sessionId: string): Promise<void> {
  const file = await findSessionFile(accessToken, sessionId)
  if (file) {
    await deleteFile(accessToken, file.id)
  }
}

/**
 * Get storage usage info
 */
export async function getStorageInfo(accessToken: string): Promise<{
  sessionCount: number
  totalSize: number
}> {
  const files = await listSessionFiles(accessToken)

  let totalSize = 0
  for (const file of files) {
    if (file.size) {
      totalSize += parseInt(file.size, 10)
    }
  }

  return {
    sessionCount: files.length,
    totalSize,
  }
}

/**
 * Clear all Raft data from Google Drive (for testing or reset)
 */
export async function clearAllData(accessToken: string): Promise<void> {
  // Delete all session files
  const files = await listSessionFiles(accessToken)
  for (const file of files) {
    await deleteFile(accessToken, file.id)
  }

  // Delete the manifest
  const manifest = await findFile(accessToken, GDRIVE_API.MANIFEST_FILE)
  if (manifest) {
    await deleteFile(accessToken, manifest.id)
  }

  // Delete key data
  const keyDataFile = await findFile(accessToken, GDRIVE_API.KEYDATA_FILE)
  if (keyDataFile) {
    await deleteFile(accessToken, keyDataFile.id)
  }

  // Delete the sessions folder
  const folder = await findFile(accessToken, GDRIVE_API.SESSIONS_FOLDER, 'folder')
  if (folder) {
    await deleteFile(accessToken, folder.id)
  }
}
