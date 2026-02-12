/**
 * Sync version from package.json to manifest.json
 *
 * Runs as prebuild hook to ensure manifest.json always has the correct version.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const pkgPath = join(rootDir, 'package.json')
const manifestPath = join(rootDir, 'manifest.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Synced version to manifest.json: ${pkg.version}`)
} else {
  console.log(`Version already in sync: ${pkg.version}`)
}
