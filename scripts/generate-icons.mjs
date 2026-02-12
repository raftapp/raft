#!/usr/bin/env node

/**
 * Generate extension icons from a source SVG.
 *
 * Usage:
 *   node scripts/generate-icons.mjs [source-svg]
 *
 * If no source SVG is provided, defaults to design-assets/icon.svg.
 * Outputs 16, 48, and 128px PNGs to public/icons/.
 *
 * Requires ImageMagick (`convert` command) on your PATH.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const sizes = [16, 48, 128]

const source = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(ROOT, 'design-assets/icon.svg')

if (!existsSync(source)) {
  console.error(`Source SVG not found: ${source}`)
  console.error(
    'Drop the designer\'s icon SVG into design-assets/icon.svg and re-run.'
  )
  process.exit(1)
}

// Verify ImageMagick is available
try {
  execSync('which convert', { stdio: 'ignore' })
} catch {
  console.error('ImageMagick `convert` not found. Install it:')
  console.error('  apt install imagemagick   # Debian/Ubuntu')
  console.error('  brew install imagemagick  # macOS')
  process.exit(1)
}

const outDir = resolve(ROOT, 'public/icons')

for (const size of sizes) {
  const out = resolve(outDir, `icon${size}.png`)
  // Use high density rendering for sharp output, then resize to exact pixel size
  const density = size * 4
  execSync(
    `convert -background none -density ${density} "${source}" -resize ${size}x${size} "${out}"`
  )
  console.log(`  ${size}x${size} → ${out}`)
}

console.log('Done! Icons written to public/icons/')
