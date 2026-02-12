/**
 * Google OAuth flow for Chrome extensions (MV3)
 *
 * Uses chrome.identity.launchWebAuthFlow() for the OAuth flow.
 * This is the recommended approach for MV3 extensions.
 */

import type { CloudTokens } from './types'
import { GOOGLE_OAUTH } from '../constants'

/**
 * Result of the OAuth flow
 */
export interface OAuthResult {
  tokens: CloudTokens
  email: string
}

/**
 * Generate a random string for PKCE code verifier
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

/**
 * Generate code challenge from verifier (S256 method)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

/**
 * Base64 URL encode (no padding, URL-safe characters)
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Launch Google OAuth flow using chrome.identity
 *
 * This opens Google's consent screen and returns an authorization code.
 * We then exchange the code for tokens.
 */
export async function launchGoogleOAuth(): Promise<OAuthResult> {
  // Clear any cached auth tokens from a previous install so Google doesn't
  // silently reuse a stale authorization that may be missing required scopes
  try {
    await chrome.identity.clearAllCachedAuthTokens()
  } catch {
    // Best-effort — not all browsers support this
  }

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  // Get the redirect URL for this extension
  const redirectUrl = chrome.identity.getRedirectURL()

  // Build the authorization URL
  const authUrl = new URL(GOOGLE_OAUTH.AUTH_URL)
  authUrl.searchParams.set('client_id', GOOGLE_OAUTH.CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUrl)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', GOOGLE_OAUTH.SCOPES.join(' '))
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent') // Always show consent to get refresh token

  // Launch the OAuth flow
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  })

  if (!responseUrl) {
    throw new Error('OAuth flow was cancelled')
  }

  // Extract the authorization code from the response URL
  const url = new URL(responseUrl)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    throw new Error(`OAuth error: ${error}`)
  }

  if (!code) {
    throw new Error('No authorization code received')
  }

  // Exchange the code for tokens
  const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUrl)

  // Get user email from the access token
  const email = await getUserEmail(tokens.accessToken)

  return { tokens, email }
}

/**
 * Exchange authorization code for access and refresh tokens
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<CloudTokens> {
  const response = await fetch(GOOGLE_OAUTH.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH.CLIENT_ID,
      client_secret: GOOGLE_OAUTH.CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`Token exchange failed: ${errorData.error_description || response.statusText}`)
  }

  const data = await response.json()

  // Validate that Google granted the drive.appdata scope we need
  const grantedScopes: string = data.scope || ''
  if (!grantedScopes.includes('drive.appdata')) {
    throw new Error(
      'Raft was not granted access to store data. Please remove Raft at https://myaccount.google.com/permissions and try again.'
    )
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  }
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<CloudTokens> {
  const response = await fetch(GOOGLE_OAUTH.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH.CLIENT_ID,
      client_secret: GOOGLE_OAUTH.CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`Token refresh failed: ${errorData.error_description || response.statusText}`)
  }

  const data = await response.json()

  return {
    accessToken: data.access_token,
    // Google may or may not return a new refresh token
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  }
}

/**
 * Get user's email from Google userinfo endpoint
 */
async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to get user info')
  }

  const data = await response.json()
  return data.email
}

/**
 * Revoke OAuth access (disconnect)
 */
export async function revokeAccess(accessToken: string): Promise<void> {
  // Revoke the token
  await fetch(`${GOOGLE_OAUTH.REVOKE_URL}?token=${accessToken}`, {
    method: 'POST',
  })

  // Also clear any cached tokens in chrome.identity
  // This is a best-effort cleanup
  try {
    await chrome.identity.clearAllCachedAuthTokens()
  } catch {
    // Ignore errors here
  }
}

/**
 * Check if tokens need refresh (within 5 minutes of expiry)
 */
export function tokensNeedRefresh(tokens: CloudTokens): boolean {
  const bufferMs = 5 * 60 * 1000 // 5 minutes
  return Date.now() >= tokens.expiresAt - bufferMs
}

/**
 * Get valid tokens, refreshing if necessary
 */
export async function getValidTokens(tokens: CloudTokens): Promise<CloudTokens> {
  if (tokensNeedRefresh(tokens)) {
    return refreshAccessToken(tokens.refreshToken)
  }
  return tokens
}
