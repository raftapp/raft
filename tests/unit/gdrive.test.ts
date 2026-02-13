/**
 * Tests for Google Drive API wrapper
 *
 * Tests the Google Drive provider for cloud sync.
 * Mocks all fetch API calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetMockChrome } from '../mocks/chrome'
import {
  uploadFile,
  downloadFile,
  deleteFile,
  listSessionFiles,
  uploadManifest,
  downloadManifest,
  uploadKeyData,
  downloadKeyData,
  uploadSession,
  downloadSession,
  deleteSession,
  getStorageInfo,
  clearAllData,
} from '@/shared/cloudSync/providers/gdrive'
import type { EncryptedPayload, SyncManifest } from '@/shared/cloudSync/types'
import { GDRIVE_API } from '@/shared/constants'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('gdrive provider', () => {
  const accessToken = 'test-access-token'

  beforeEach(() => {
    resetMockChrome()
    vi.clearAllMocks()
  })

  describe('uploadFile', () => {
    it('should create new file when it does not exist', async () => {
      // File doesn't exist
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      // Create file response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'new-file-id' }),
      })

      const fileId = await uploadFile(accessToken, 'test.json', '{"data":"test"}')

      expect(fileId).toBe('new-file-id')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should update existing file', async () => {
      // File exists
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [{ id: 'existing-file-id' }] }),
      })

      // Update file response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      })

      const fileId = await uploadFile(accessToken, 'test.json', '{"data":"test"}')

      expect(fileId).toBe('existing-file-id')

      // Check update call used PATCH
      const updateCall = mockFetch.mock.calls[1]
      expect(updateCall[0]).toContain('existing-file-id')
      expect(updateCall[1].method).toBe('PATCH')
    })

    it('should use parent folder when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'new-id' }),
      })

      await uploadFile(accessToken, 'file.json', 'content', 'parent-folder-id')

      const createCall = mockFetch.mock.calls[1]
      expect(createCall[1].body).toContain('parent-folder-id')
    })

    it('should send authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'id' }),
      })

      await uploadFile(accessToken, 'file.json', 'content')

      const firstCall = mockFetch.mock.calls[0]
      expect(firstCall[1].headers.Authorization).toBe(`Bearer ${accessToken}`)
    })

    it('should throw on upload failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(uploadFile(accessToken, 'file.json', 'content')).rejects.toThrow(
        'Upload failed'
      )
    })
  })

  describe('downloadFile', () => {
    it('should download file content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"content":"downloaded"}',
      })

      const content = await downloadFile(accessToken, 'file-id-123')

      expect(content).toBe('{"content":"downloaded"}')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('file-id-123'),
        expect.objectContaining({
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      )
    })

    it('should throw on download failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(downloadFile(accessToken, 'invalid-id')).rejects.toThrow(
        'Download failed: Not Found'
      )
    })
  })

  describe('deleteFile', () => {
    it('should delete a file', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      await deleteFile(accessToken, 'file-to-delete')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('file-to-delete'),
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      )
    })

    it('should throw on delete failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: { message: 'Access denied' } }),
      })

      await expect(deleteFile(accessToken, 'protected-file')).rejects.toThrow()
    })
  })

  describe('listSessionFiles', () => {
    it('should return empty array when sessions folder does not exist', async () => {
      // Find sessions folder - not found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      const files = await listSessionFiles(accessToken)
      expect(files).toEqual([])
    })

    it('should list files in sessions folder', async () => {
      // Find sessions folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'sessions-folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })

      // List files in folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            { id: 'file1', name: 'session1.enc', size: '1024', modifiedTime: '2024-01-01' },
            { id: 'file2', name: 'session2.enc', size: '2048', modifiedTime: '2024-01-02' },
          ],
        }),
      })

      const files = await listSessionFiles(accessToken)

      expect(files).toHaveLength(2)
      expect(files[0].name).toBe('session1.enc')
      expect(files[1].name).toBe('session2.enc')
    })
  })

  describe('uploadManifest', () => {
    it('should upload manifest file', async () => {
      // Check for existing file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      // Create file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'manifest-id' }),
      })

      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'device-123',
        sessions: [],
        tombstones: [],
      }

      await uploadManifest(accessToken, manifest)

      // Verify the manifest content was serialized
      const createCall = mockFetch.mock.calls[1]
      expect(createCall[1].body).toContain('"version":1')
    })
  })

  describe('downloadManifest', () => {
    it('should return null when manifest does not exist', async () => {
      // Find manifest file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      const result = await downloadManifest(accessToken)
      expect(result).toBeNull()
    })

    it('should download and parse manifest', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastSync: 12345,
        deviceId: 'device-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            updatedAt: 12345,
            tabCount: 10,
            checksum: 'abc123',
          },
        ],
        tombstones: [],
      }

      // Find manifest file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'manifest-file-id', name: GDRIVE_API.MANIFEST_FILE }],
        }),
      })

      // Download manifest content
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(manifest),
      })

      const result = await downloadManifest(accessToken)

      expect(result).toEqual(manifest)
    })
  })

  describe('uploadKeyData', () => {
    it('should upload key data to Drive', async () => {
      const keyData = {
        salt: 'test-salt-base64',
        verificationHash: 'test-hash-abc123',
      }

      // uploadFile checks for existing file (driveRequest search)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      // Create file response (multipart upload via fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'keydata-file-id' }),
      })

      await uploadKeyData(accessToken, keyData)

      expect(mockFetch).toHaveBeenCalledTimes(2)

      // The second call is the multipart upload to create the file
      const createCall = mockFetch.mock.calls[1]
      expect(createCall[0]).toContain('uploadType=multipart')
      expect(createCall[1].method).toBe('POST')
      expect(createCall[1].body).toContain(GDRIVE_API.KEYDATA_FILE)
      expect(createCall[1].body).toContain('"salt":"test-salt-base64"')
      expect(createCall[1].body).toContain('"verificationHash":"test-hash-abc123"')
    })
  })

  describe('downloadKeyData', () => {
    it('should download key data from Drive', async () => {
      const keyData = {
        salt: 'test-salt-base64',
        verificationHash: 'test-hash-abc123',
      }

      // findFile search via driveRequest — file exists
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'keydata-file-id', name: GDRIVE_API.KEYDATA_FILE }],
        }),
      })

      // downloadFile — direct fetch returning the key data content
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(keyData),
      })

      const result = await downloadKeyData(accessToken)

      expect(result).toEqual(keyData)

      // Verify the search called the files endpoint with the keydata filename
      const searchCall = mockFetch.mock.calls[0]
      expect(searchCall[0]).toContain(encodeURIComponent(GDRIVE_API.KEYDATA_FILE))
      expect(searchCall[1].headers.Authorization).toBe(`Bearer ${accessToken}`)

      // Verify the download call fetched the correct file
      const downloadCall = mockFetch.mock.calls[1]
      expect(downloadCall[0]).toContain('keydata-file-id')
      expect(downloadCall[0]).toContain('alt=media')
    })

    it('should return null when key data is not found', async () => {
      // findFile search via driveRequest — no files
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      const result = await downloadKeyData(accessToken)

      expect(result).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('uploadSession', () => {
    it('should upload encrypted session to sessions folder', async () => {
      // Find sessions folder - not found, need to create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      // Create sessions folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'new-folder-id' }),
      })

      // Check for existing session file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      // Upload session file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'session-file-id' }),
      })

      const encryptedData: EncryptedPayload = {
        v: 1,
        iv: 'test-iv',
        ct: 'encrypted-content',
      }

      await uploadSession(accessToken, 'session-123', encryptedData)

      // Verify session file was created with correct name
      const uploadCall = mockFetch.mock.calls[3]
      expect(uploadCall[1].body).toContain('session-123.enc')
    })
  })

  describe('downloadSession', () => {
    it('should return null when session does not exist', async () => {
      // Find sessions folder - exists
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })

      // Find session file - not found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      const result = await downloadSession(accessToken, 'non-existent-session')
      expect(result).toBeNull()
    })

    it('should download and parse encrypted session', async () => {
      const encryptedData: EncryptedPayload = {
        v: 1,
        iv: 'test-iv',
        ct: 'encrypted-content',
      }

      // Find sessions folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })

      // Find session file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'session-file-id', name: 'session-123.enc' }],
        }),
      })

      // Download file content
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(encryptedData),
      })

      const result = await downloadSession(accessToken, 'session-123')
      expect(result).toEqual(encryptedData)
    })
  })

  describe('deleteSession', () => {
    it('should do nothing when session does not exist', async () => {
      // Find sessions folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })

      // Find session file - not found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      await deleteSession(accessToken, 'non-existent')

      // Only 2 calls (folder lookup and file search)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should delete session file when it exists', async () => {
      // Find sessions folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })

      // Find session file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'session-file-id', name: 'session-123.enc' }],
        }),
      })

      // Delete file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      await deleteSession(accessToken, 'session-123')

      // Verify delete was called
      const deleteCall = mockFetch.mock.calls[2]
      expect(deleteCall[1].method).toBe('DELETE')
      expect(deleteCall[0]).toContain('session-file-id')
    })
  })

  describe('getStorageInfo', () => {
    it('should return zero counts when no sessions exist', async () => {
      // Find sessions folder - not found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      })

      const info = await getStorageInfo(accessToken)

      expect(info.sessionCount).toBe(0)
      expect(info.totalSize).toBe(0)
    })

    it('should calculate total size from all session files', async () => {
      // Find sessions folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })

      // List session files
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            { id: 'file1', name: 's1.enc', size: '1024' },
            { id: 'file2', name: 's2.enc', size: '2048' },
            { id: 'file3', name: 's3.enc', size: '512' },
          ],
        }),
      })

      const info = await getStorageInfo(accessToken)

      expect(info.sessionCount).toBe(3)
      expect(info.totalSize).toBe(1024 + 2048 + 512)
    })
  })

  describe('clearAllData', () => {
    it('should delete all session files, manifest, and folder', async () => {
      // List session files
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            { id: 'file1', name: 's1.enc' },
            { id: 'file2', name: 's2.enc' },
          ],
        }),
      })

      // Delete session files
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 }) // file1
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 }) // file2

      // Find and delete manifest
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'manifest-id', name: GDRIVE_API.MANIFEST_FILE }],
        }),
      })
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 }) // delete manifest

      // Find and delete key data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'keydata-id', name: GDRIVE_API.KEYDATA_FILE }],
        }),
      })
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 }) // delete keydata

      // Find and delete sessions folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'folder-id', name: GDRIVE_API.SESSIONS_FOLDER }],
        }),
      })
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 }) // delete folder

      await clearAllData(accessToken)

      // Count delete calls (files + manifest + keydata + folder)
      const deleteCalls = mockFetch.mock.calls.filter(
        call => call[1]?.method === 'DELETE'
      )
      expect(deleteCalls.length).toBe(5) // 2 files + 1 manifest + 1 keydata + 1 folder
    })
  })

  describe('error handling', () => {
    it('should return user-friendly message for 401 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          error: { message: 'Invalid credentials' },
        }),
      })

      await expect(
        uploadFile(accessToken, 'file.json', 'content')
      ).rejects.toThrow('Authentication expired')
    })

    it('should return user-friendly message for 403 rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          error: {
            message: 'Rate limit exceeded',
            errors: [{ reason: 'rateLimitExceeded' }],
          },
        }),
      })

      await expect(
        uploadFile(accessToken, 'file.json', 'content')
      ).rejects.toThrow('Rate limited')
    })

    it('should return actual error message for non-rate-limit 403 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          error: { message: 'Insufficient permissions' },
        }),
      })

      await expect(
        uploadFile(accessToken, 'file.json', 'content')
      ).rejects.toThrow('Access denied: Insufficient permissions')
    })

    it('should include error message from Drive API response for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({
          error: { message: 'Something went wrong' },
        }),
      })

      await expect(
        uploadFile(accessToken, 'file.json', 'content')
      ).rejects.toThrow('Something went wrong')
    })

    it('should fallback to status text when no error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Not JSON')
        },
      })

      await expect(
        uploadFile(accessToken, 'file.json', 'content')
      ).rejects.toThrow('Internal Server Error')
    })
  })
})
