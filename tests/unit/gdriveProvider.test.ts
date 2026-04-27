/**
 * Tests for the Google Drive SyncProvider adapter.
 *
 * The adapter is a thin delegation layer over providers/gdrive.ts. These
 * tests pin the contract: every SyncProvider method dispatches to the right
 * gdrive function with the right arguments, and `list()` correctly translates
 * Drive file metadata into the backend-agnostic SyncObjectInfo shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createGoogleDriveProvider } from '@/shared/cloudSync/providers/gdriveProvider'
import type { EncryptedPayload, SyncManifest } from '@/shared/cloudSync/types'

vi.mock('@/shared/cloudSync/providers/gdrive', () => ({
  downloadManifest: vi.fn(),
  uploadManifest: vi.fn(),
  listSessionFiles: vi.fn(),
  downloadSession: vi.fn(),
  uploadSession: vi.fn(),
  deleteSession: vi.fn(),
  downloadKeyData: vi.fn(),
  uploadKeyData: vi.fn(),
  clearAllData: vi.fn(),
}))

import * as gdrive from '@/shared/cloudSync/providers/gdrive'

describe('createGoogleDriveProvider', () => {
  const accessToken = 'test-token'
  const provider = createGoogleDriveProvider(accessToken)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getManifest delegates to downloadManifest', async () => {
    const manifest: SyncManifest = {
      version: 1,
      lastSync: 1,
      deviceId: 'd',
      sessions: [],
      tombstones: [],
    }
    vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)

    await expect(provider.getManifest()).resolves.toBe(manifest)
    expect(gdrive.downloadManifest).toHaveBeenCalledWith(accessToken)
  })

  it('setManifest delegates to uploadManifest', async () => {
    const manifest: SyncManifest = {
      version: 1,
      lastSync: 1,
      deviceId: 'd',
      sessions: [],
      tombstones: [],
    }

    await provider.setManifest(manifest)
    expect(gdrive.uploadManifest).toHaveBeenCalledWith(accessToken, manifest)
  })

  it('read delegates to downloadSession', async () => {
    const payload: EncryptedPayload = { v: 1, iv: 'iv', ct: 'ct' }
    vi.mocked(gdrive.downloadSession).mockResolvedValue(payload)

    await expect(provider.read('sess-1')).resolves.toBe(payload)
    expect(gdrive.downloadSession).toHaveBeenCalledWith(accessToken, 'sess-1')
  })

  it('write delegates to uploadSession', async () => {
    const payload: EncryptedPayload = { v: 1, iv: 'iv', ct: 'ct' }

    await provider.write('sess-1', payload)
    expect(gdrive.uploadSession).toHaveBeenCalledWith(accessToken, 'sess-1', payload)
  })

  it('delete delegates to deleteSession', async () => {
    await provider.delete('sess-1')
    expect(gdrive.deleteSession).toHaveBeenCalledWith(accessToken, 'sess-1')
  })

  it('getKeyData delegates to downloadKeyData', async () => {
    const keyData = { salt: 's', verificationHash: 'h' }
    vi.mocked(gdrive.downloadKeyData).mockResolvedValue(keyData)

    await expect(provider.getKeyData()).resolves.toBe(keyData)
    expect(gdrive.downloadKeyData).toHaveBeenCalledWith(accessToken)
  })

  it('setKeyData delegates to uploadKeyData', async () => {
    const keyData = { salt: 's', verificationHash: 'h' }

    await provider.setKeyData(keyData)
    expect(gdrive.uploadKeyData).toHaveBeenCalledWith(accessToken, keyData)
  })

  it('clearAll delegates to clearAllData', async () => {
    await provider.clearAll()
    expect(gdrive.clearAllData).toHaveBeenCalledWith(accessToken)
  })

  describe('list', () => {
    it('strips .enc suffix and translates size/modifiedTime', async () => {
      vi.mocked(gdrive.listSessionFiles).mockResolvedValue([
        {
          id: 'drive-id-1',
          name: 'sess-1.enc',
          mimeType: 'application/json',
          modifiedTime: '2024-01-15T12:00:00.000Z',
          size: '2048',
        },
        {
          id: 'drive-id-2',
          name: 'sess-2.enc',
          mimeType: 'application/json',
          modifiedTime: '2024-02-20T08:30:00.000Z',
          size: '1024',
        },
      ])

      const result = await provider.list()

      expect(result).toEqual([
        {
          id: 'sess-1',
          size: 2048,
          modifiedAt: Date.parse('2024-01-15T12:00:00.000Z'),
        },
        {
          id: 'sess-2',
          size: 1024,
          modifiedAt: Date.parse('2024-02-20T08:30:00.000Z'),
        },
      ])
      expect(gdrive.listSessionFiles).toHaveBeenCalledWith(accessToken)
    })

    it('passes through names without .enc suffix unchanged', async () => {
      vi.mocked(gdrive.listSessionFiles).mockResolvedValue([
        {
          id: 'drive-id-x',
          name: 'legacy-name',
          mimeType: 'application/json',
          modifiedTime: '2024-01-01T00:00:00.000Z',
        },
      ])

      const result = await provider.list()

      expect(result[0].id).toBe('legacy-name')
    })

    it('leaves size and modifiedAt undefined when fields missing', async () => {
      vi.mocked(gdrive.listSessionFiles).mockResolvedValue([
        {
          id: 'drive-id-y',
          name: 'sess-bare.enc',
          mimeType: 'application/json',
          modifiedTime: '',
        },
      ])

      const result = await provider.list()

      expect(result[0]).toEqual({
        id: 'sess-bare',
        size: undefined,
        modifiedAt: undefined,
      })
    })
  })
})
