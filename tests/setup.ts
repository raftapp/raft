/**
 * Vitest Global Test Setup
 *
 * This file runs before each test file and sets up the testing environment.
 */

import { beforeEach, vi } from 'vitest'
import { mockChrome, resetMockChrome } from './mocks/chrome'

// Install mock chrome globally
vi.stubGlobal('chrome', mockChrome)

// Mock extension version global
vi.stubGlobal('__EXTENSION_VERSION__', '0.0.0-test')

// Reset all mocks before each test
beforeEach(() => {
  resetMockChrome()
  vi.clearAllMocks()
})
