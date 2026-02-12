/**
 * Tests for OAuth flow
 *
 * Tests the Google OAuth integration for cloud sync.
 * Mocks chrome.identity and fetch APIs.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resetMockChrome, mockChrome } from '../mocks/chrome'
import {
  tokensNeedRefresh,
  getValidTokens,
  refreshAccessToken,
  revokeAccess,
  launchGoogleOAuth,
} from '@/shared/cloudSync/oauth'
import type { CloudTokens } from '@/shared/cloudSync/types'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('oauth', () => {
  beforeEach(() => {
    resetMockChrome()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('tokensNeedRefresh', () => {
    it('should return false when tokens are fresh', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const tokens: CloudTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: now + 60 * 60 * 1000, // 1 hour from now
        scope: 'https://www.googleapis.com/auth/drive.appdata',
      }

      expect(tokensNeedRefresh(tokens)).toBe(false)
    })

    it('should return true when within 5 minutes of expiry', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const tokens: CloudTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: now + 4 * 60 * 1000, // 4 minutes from now (within 5 min buffer)
        scope: 'https://www.googleapis.com/auth/drive.appdata',
      }

      expect(tokensNeedRefresh(tokens)).toBe(true)
    })

    it('should return true when tokens have expired', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const tokens: CloudTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: now - 1000, // Already expired
        scope: 'https://www.googleapis.com/auth/drive.appdata',
      }

      expect(tokensNeedRefresh(tokens)).toBe(true)
    })

    it('should return false when exactly at 5 minute boundary', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const tokens: CloudTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: now + 5 * 60 * 1000 + 1, // Just over 5 minutes
        scope: 'https://www.googleapis.com/auth/drive.appdata',
      }

      expect(tokensNeedRefresh(tokens)).toBe(false)
    })
  })

  describe('getValidTokens', () => {
    it('should return tokens unchanged if not expired', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const tokens: CloudTokens = {
        accessToken: 'valid-access-token',
        refreshToken: 'refresh-token',
        expiresAt: now + 60 * 60 * 1000, // 1 hour from now
        scope: 'https://www.googleapis.com/auth/drive.appdata',
      }

      const result = await getValidTokens(tokens)
      expect(result).toBe(tokens)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should refresh tokens if near expiry', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const tokens: CloudTokens = {
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: now + 2 * 60 * 1000, // 2 minutes (within buffer)
        scope: 'https://www.googleapis.com/auth/drive.appdata',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.appdata',
        }),
      })

      const result = await getValidTokens(tokens)
      expect(result.accessToken).toBe('new-access-token')
      expect(result.refreshToken).toBe('refresh-token') // Preserved
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('refreshAccessToken', () => {
    it('should refresh and return new tokens', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.appdata',
        }),
      })

      const result = await refreshAccessToken('my-refresh-token')

      expect(result.accessToken).toBe('new-access-token')
      expect(result.refreshToken).toBe('my-refresh-token')
      expect(result.expiresAt).toBe(now + 3600 * 1000)
      expect(result.scope).toBe('https://www.googleapis.com/auth/drive.appdata')
    })

    it('should use new refresh token if provided by Google', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.appdata',
        }),
      })

      const result = await refreshAccessToken('old-refresh-token')
      expect(result.refreshToken).toBe('new-refresh-token')
    })

    it('should throw on token refresh failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({
          error_description: 'Token has been revoked',
        }),
      })

      await expect(refreshAccessToken('invalid-token')).rejects.toThrow(
        'Token refresh failed: Token has been revoked'
      )
    })

    it('should handle JSON parse error gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Not JSON')
        },
      })

      await expect(refreshAccessToken('token')).rejects.toThrow(
        'Token refresh failed: Internal Server Error'
      )
    })

    it('should send correct request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token',
          expires_in: 3600,
          scope: 'scope',
        }),
      })

      await refreshAccessToken('my-refresh-token')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
      )

      const call = mockFetch.mock.calls[0]
      const body = call[1].body.toString()
      expect(body).toContain('refresh_token=my-refresh-token')
      expect(body).toContain('grant_type=refresh_token')
    })
  })

  describe('revokeAccess', () => {
    it('should call revoke endpoint with token', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      await revokeAccess('access-token-to-revoke')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('token=access-token-to-revoke'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should clear cached auth tokens', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      // Add clearAllCachedAuthTokens to mock
      mockChrome.identity = {
        ...mockChrome.identity,
        getRedirectURL: vi.fn(() => 'https://mock-redirect-url'),
        launchWebAuthFlow: vi.fn(),
        clearAllCachedAuthTokens: vi.fn().mockResolvedValue(undefined),
      }

      await revokeAccess('token')

      expect(mockChrome.identity.clearAllCachedAuthTokens).toHaveBeenCalled()
    })

    it('should not throw if clearAllCachedAuthTokens fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      mockChrome.identity = {
        ...mockChrome.identity,
        getRedirectURL: vi.fn(() => 'https://mock-redirect-url'),
        launchWebAuthFlow: vi.fn(),
        clearAllCachedAuthTokens: vi.fn().mockRejectedValue(new Error('Failed')),
      }

      // Should not throw
      await revokeAccess('token')
    })
  })

  describe('launchGoogleOAuth', () => {
    beforeEach(() => {
      // Setup identity mock
      mockChrome.identity = {
        getRedirectURL: vi.fn(() => 'https://mock-extension-id.chromiumapp.org/'),
        launchWebAuthFlow: vi.fn(),
        clearAllCachedAuthTokens: vi.fn(),
      }
    })

    it('should launch OAuth flow and return tokens and email', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      // Mock launchWebAuthFlow to return auth code
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(
        'https://mock-extension-id.chromiumapp.org/?code=auth-code-123'
      )

      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.appdata',
        }),
      })

      // Mock user info fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'user@example.com',
        }),
      })

      const result = await launchGoogleOAuth()

      expect(result.tokens.accessToken).toBe('new-access-token')
      expect(result.tokens.refreshToken).toBe('new-refresh-token')
      expect(result.tokens.expiresAt).toBe(now + 3600 * 1000)
      expect(result.email).toBe('user@example.com')
    })

    it('should throw if OAuth flow is cancelled', async () => {
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(null)

      await expect(launchGoogleOAuth()).rejects.toThrow('OAuth flow was cancelled')
    })

    it('should throw if OAuth returns error', async () => {
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(
        'https://mock-redirect/?error=access_denied'
      )

      await expect(launchGoogleOAuth()).rejects.toThrow('OAuth error: access_denied')
    })

    it('should throw if no authorization code received', async () => {
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(
        'https://mock-redirect/?other=param'
      )

      await expect(launchGoogleOAuth()).rejects.toThrow('No authorization code received')
    })

    it('should throw if token exchange fails', async () => {
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(
        'https://mock-redirect/?code=valid-code'
      )

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({
          error_description: 'Invalid code',
        }),
      })

      await expect(launchGoogleOAuth()).rejects.toThrow('Token exchange failed: Invalid code')
    })

    it('should throw if user info fetch fails', async () => {
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(
        'https://mock-redirect/?code=valid-code'
      )

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.appdata',
        }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
      })

      await expect(launchGoogleOAuth()).rejects.toThrow('Failed to get user info')
    })

    it('should use PKCE with code challenge', async () => {
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(
        'https://mock-redirect/?code=code'
      )

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.appdata',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' }),
        })

      await launchGoogleOAuth()

      // Check that launchWebAuthFlow was called with code_challenge
      const authUrl = mockChrome.identity.launchWebAuthFlow.mock.calls[0][0].url
      expect(authUrl).toContain('code_challenge=')
      expect(authUrl).toContain('code_challenge_method=S256')

      // Check that token exchange includes code_verifier
      const tokenCall = mockFetch.mock.calls[0]
      const body = tokenCall[1].body.toString()
      expect(body).toContain('code_verifier=')
    })

    it('should request offline access and consent prompt', async () => {
      mockChrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue(
        'https://mock-redirect/?code=code'
      )

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.appdata',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' }),
        })

      await launchGoogleOAuth()

      const authUrl = mockChrome.identity.launchWebAuthFlow.mock.calls[0][0].url
      expect(authUrl).toContain('access_type=offline')
      expect(authUrl).toContain('prompt=consent')
    })
  })
})
