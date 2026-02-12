import { defineConfig, loadEnv, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import pkg from './package.json'
import { resolve } from 'path'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'

// Vite plugin to relax CSP during development so the Vite HMR websocket can connect.
// CRXJS doesn't patch connect-src when it's explicitly declared in the manifest.
function relaxCspForDev(): Plugin {
  return {
    name: 'relax-csp-for-dev',
    enforce: 'pre',
    config(_config, { mode }) {
      if (mode !== 'development') return
      const csp = manifest.content_security_policy
      if (csp?.extension_pages) {
        csp.extension_pages = csp.extension_pages.replace(
          /connect-src\s+/,
          'connect-src http://localhost:* ws://localhost:* '
        )
      }
    },
  }
}

// Vite plugin to restrict web_accessible_resources in the built manifest.
// CRXJS generates wildcard patterns that expose all extension resources
// to web pages. This plugin strips those patterns after build.
function restrictWebAccessibleResources(): Plugin {
  return {
    name: 'restrict-web-accessible-resources',
    apply: 'build',
    closeBundle() {
      const manifestPath = resolve(__dirname, 'dist/manifest.json')
      try {
        const content = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        // Remove the wildcard web_accessible_resources entirely
        // Raft doesn't need any web-accessible resources (the suspended page
        // is navigated to via chrome.tabs.update, not loaded from web context)
        delete content.web_accessible_resources
        writeFileSync(manifestPath, JSON.stringify(content, null, 2))
      } catch {
        // Ignore if dist doesn't exist yet (e.g. during dev)
      }
    },
  }
}

// Vite plugin to ensure no unreplaced __PLACEHOLDER__ strings remain in the build.
// Scans all .js files in dist/ for the pattern /__[A-Z][A-Z0-9_]+__/.
// The leading [A-Z] avoids false positives from minified variable names.
function validateNoPlaceholders(): Plugin {
  return {
    name: 'validate-no-placeholders',
    apply: 'build',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist')
      const placeholderPattern = /__[A-Z][A-Z0-9_]+__/g
      const issues: string[] = []

      function scanDir(dir: string): void {
        for (const entry of readdirSync(dir)) {
          const fullPath = resolve(dir, entry)
          if (statSync(fullPath).isDirectory()) {
            scanDir(fullPath)
          } else if (entry.endsWith('.js')) {
            const content = readFileSync(fullPath, 'utf-8')
            const matches = content.match(placeholderPattern)
            if (matches) {
              const unique = [...new Set(matches)]
              const relPath = fullPath.replace(distDir + '/', '')
              issues.push(`  ${relPath}: ${unique.join(', ')}`)
            }
          }
        }
      }

      try {
        scanDir(distDir)
      } catch {
        // Ignore if dist doesn't exist yet (e.g. during dev)
        return
      }

      if (issues.length > 0) {
        throw new Error(
          'Unreplaced placeholder strings found in build output:\n' + issues.join('\n')
        )
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const version = pkg.version
  const env = loadEnv(mode, process.cwd(), '')

  const googleClientId = env.VITE_GOOGLE_CLIENT_ID
  const googleClientSecret = env.VITE_GOOGLE_CLIENT_SECRET

  if (!googleClientId || !googleClientSecret) {
    throw new Error(
      'Missing Google OAuth credentials.\n' +
        'Copy .env.example to .env and fill in VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_SECRET.\n' +
        'See CLAUDE.md for setup instructions.'
    )
  }

  // Inject the real client_id into the manifest before CRXJS processes it
  manifest.oauth2.client_id = googleClientId

  return {
    base: '',
    plugins: [
      preact(),
      relaxCspForDev(),
      crx({ manifest }),
      restrictWebAccessibleResources(),
      validateNoPlaceholders(),
    ],
    define: {
      __EXTENSION_VERSION__: JSON.stringify(version),
      __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleClientId),
      __GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(googleClientSecret),
    },
    server: {
      port: 5188,
      strictPort: true,
      cors: true,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/popup/index.html'),
          options: resolve(__dirname, 'src/options/index.html'),
          onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html', 'lcov'],
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: [
          'src/**/*.d.ts',
          'src/**/*.tsx', // UI components - tested separately
          'src/**/index.ts', // Entry points
          'src/shared/stores/**', // Zustand stores - tested via integration
          'src/shared/a11y/**', // Accessibility hooks - tested via E2E
          'src/devtools/**', // DevTools scenarios - tested manually
        ],
        thresholds: {
          statements: 70,
          branches: 65,
          functions: 70,
          lines: 70,
        },
      },
    },
  }
})
