#!/usr/bin/env node

/**
 * Trust Report Generator
 *
 * Reads Vitest JSON reporter output from safety tests and generates
 * a human-readable markdown report for docs/SAFETY-REPORT.md.
 *
 * Usage: node scripts/generate-trust-report.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INPUT = resolve(__dirname, '..', 'coverage', 'safety-results.json')
const OUTPUT = resolve(__dirname, '..', 'docs', 'SAFETY-REPORT.md')

const SECTION_DESCRIPTIONS = {
  'Your tabs are saved exactly as they were':
    'Every property of every tab -- URL, title, favicon, pinned state, position, tab group membership, and window state -- is verified to survive capture and storage without modification.',
  'Your data travels safely between formats':
    "Raft's export and import functions preserve data through round-trips. Imports from OneTab, Session Buddy, Tab Session Manager, and Toby are tested. Malformed and malicious input is rejected safely.",
  'Your sessions survive browser crashes':
    "Recovery snapshots capture the complete browser state and persist to chrome.storage. Failure injection tests prove that a failed save never corrupts or destroys your existing sessions.",
  'Your data stays on your device':
    "Raft's save, restore, capture, import, and export code paths are verified to never call fetch() or XMLHttpRequest. Your session data never leaves your browser unless you explicitly enable Cloud Sync.",
  'Raft handles your biggest sessions':
    'Scale tests verify correct behavior with 100+ tabs, 200+ tabs with 20 tab groups, 1000 stored sessions, chunked sync storage for 500+ tabs, and search across 50 sessions.',
}

function main() {
  let data
  try {
    data = JSON.parse(readFileSync(INPUT, 'utf-8'))
  } catch (err) {
    console.error(`Failed to read ${INPUT}:`, err.message)
    console.error('Run "pnpm test:trust-report" to generate the JSON output first.')
    process.exit(1)
  }

  const testSuites = data.testResults || []
  const allTests = []

  for (const suite of testSuites) {
    for (const test of suite.assertionResults || []) {
      allTests.push({
        ancestorTitles: test.ancestorTitles || [],
        title: test.title,
        status: test.status, // 'passed', 'failed', 'pending'
      })
    }
  }

  // Group by top-level describe block
  const groups = new Map()
  for (const test of allTests) {
    const topLevel = test.ancestorTitles[0] || 'Other'
    if (!groups.has(topLevel)) {
      groups.set(topLevel, [])
    }
    groups.get(topLevel).push(test)
  }

  const date = new Date().toISOString().split('T')[0]
  const totalTests = allTests.length
  const totalPassed = allTests.filter((t) => t.status === 'passed').length
  const allPassing = totalTests === totalPassed

  const lines = []

  lines.push('# Raft Data Safety Report')
  lines.push('')
  lines.push(`> Auto-generated from automated tests on ${date}.`)
  lines.push('> Run `pnpm test:safety` to verify independently.')
  lines.push('')

  // Summary table
  lines.push('| Claim | Tests | Status |')
  lines.push('|-------|-------|--------|')

  for (const [claim, tests] of groups) {
    const passed = tests.filter((t) => t.status === 'passed').length
    const status = passed === tests.length ? 'PASS' : 'FAIL'
    lines.push(`| ${claim} | ${tests.length} | ${status} |`)
  }

  lines.push(
    `| **Total** | **${totalTests}** | **${allPassing ? 'ALL PASSING' : 'SOME FAILING'}** |`
  )
  lines.push('')

  // Detailed sections
  for (const [claim, tests] of groups) {
    lines.push(`## ${claim}`)
    lines.push('')
    if (SECTION_DESCRIPTIONS[claim]) {
      lines.push(SECTION_DESCRIPTIONS[claim])
      lines.push('')
    }

    for (const test of tests) {
      const icon = test.status === 'passed' ? 'PASS' : 'FAIL'
      lines.push(`- [${icon}] ${test.title}`)
    }
    lines.push('')
  }

  const content = lines.join('\n')

  // Ensure docs/ directory exists
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, content)

  console.log(`Safety report written to ${OUTPUT}`)
  console.log(`  ${totalTests} tests, ${totalPassed} passed, ${totalTests - totalPassed} failed`)

  if (!allPassing) {
    process.exit(1)
  }
}

main()
