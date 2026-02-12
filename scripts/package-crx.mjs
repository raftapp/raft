/**
 * Package the extension for Chrome Web Store or self-distribution.
 *
 * Usage:
 *   pnpm package          — Build + zip dist/ for CWS upload
 *   pnpm package:crx      — Build + sign CRX3 with Chrome (requires raft.pem)
 *
 * Set CRX_KEY_PATH env var to override the default key location (raft.pem).
 * Set CHROME_PATH env var if google-chrome is not on PATH.
 */

import { readFileSync, writeFileSync, existsSync, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'))
const version = pkg.version
const mode = process.argv[2] || 'zip'

console.log(`Building extension v${version}...`)
execSync('pnpm build', { cwd: rootDir, stdio: 'inherit' })

if (mode === 'crx') {
  const keyPath = process.env.CRX_KEY_PATH || join(homedir(), '.ssh', 'raft.pem')

  if (!existsSync(keyPath)) {
    console.error(
      `Error: Signing key not found at ${keyPath}\n` +
        'Pull raft.pem from 1Password, or set CRX_KEY_PATH.\n' +
        'This is only needed for signed CRX uploads after enabling verified signing in CWS.'
    )
    process.exit(1)
  }

  const chrome =
    process.env.CHROME_PATH ||
    ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'].find((bin) => {
      try {
        execSync(`which ${bin}`, { stdio: 'ignore' })
        return true
      } catch {
        return false
      }
    })

  if (!chrome) {
    console.error(
      'Error: Chrome/Chromium not found on PATH.\n' +
        'Set CHROME_PATH env var to your Chrome binary.'
    )
    process.exit(1)
  }

  const distDir = join(rootDir, 'dist')
  execSync(`${chrome} --pack-extension=${distDir} --pack-extension-key=${keyPath}`, {
    stdio: 'inherit',
  })

  // Chrome outputs dist.crx next to the dist/ folder
  const chromeOutput = join(rootDir, 'dist.crx')
  const outputPath = join(rootDir, `raft-${version}.crx`)

  if (existsSync(chromeOutput)) {
    const { renameSync } = await import('fs')
    renameSync(chromeOutput, outputPath)
    console.log(`Wrote ${outputPath}`)
  } else {
    console.error('Chrome did not produce a .crx file. Check output above for errors.')
    process.exit(1)
  }
} else {
  // ZIP mode — for CWS upload (key field stripped; CWS rejects it for new items)
  const distDir = join(rootDir, 'dist')
  const distManifestPath = join(distDir, 'manifest.json')
  const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf-8'))

  if (distManifest.key) {
    delete distManifest.key
    writeFileSync(distManifestPath, JSON.stringify(distManifest, null, 2) + '\n')
    console.log('Stripped "key" field from dist/manifest.json for CWS upload')
  }

  const { default: archiver } = await import('archiver')
  const outputPath = join(rootDir, `raft-${version}.zip`)

  const output = createWriteStream(outputPath)
  const archive = archiver('zip', { zlib: { level: 9 } })

  archive.pipe(output)
  archive.directory(distDir, false)

  await archive.finalize()
  console.log(`Wrote ${outputPath}`)
}
