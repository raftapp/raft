# Raft Data Safety Report

> Auto-generated from automated tests on 2026-02-12.
> Run `pnpm test:safety` to verify independently.

| Claim | Tests | Status |
|-------|-------|--------|
| Your sessions survive browser crashes | 13 | PASS |
| Your data stays on your device | 8 | PASS |
| Your data travels safely between formats | 15 | PASS |
| Raft handles your biggest sessions | 6 | PASS |
| Your tabs are saved exactly as they were | 13 | PASS |
| **Total** | **55** | **ALL PASSING** |

## Your sessions survive browser crashes

Recovery snapshots capture the complete browser state and persist to chrome.storage. Failure injection tests prove that a failed save never corrupts or destroys your existing sessions.

- [PASS] captures all tabs across all windows
- [PASS] captures tab groups with membership
- [PASS] captures pinned and suspended states
- [PASS] full round-trip: capture -> store -> retrieve -> restore
- [PASS] failed save does not destroy existing sessions
- [PASS] storage quota error throws without silent data loss
- [PASS] mid-write failure preserves session structure integrity
- [PASS] snapshot available after simulated restart
- [PASS] snapshot restores all windows and tabs
- [PASS] keeps 5 most recent snapshots (rotation)
- [PASS] sync storage provides backup copy
- [PASS] missing session data doesn't crash
- [PASS] recovery snapshot with missing chunks returns null

## Your data stays on your device

Raft's save, restore, capture, import, and export code paths are verified to never call fetch() or XMLHttpRequest. Your session data never leaves your browser unless you explicitly enable Cloud Sync.

- [PASS] captureCurrentSession never calls fetch
- [PASS] saveSession only writes to chrome.storage.local
- [PASS] restoreSession makes no network calls
- [PASS] captureRecoverySnapshot never calls fetch
- [PASS] restoreFromSnapshot never calls fetch
- [PASS] importSessions makes no network calls
- [PASS] exportAsJson makes no network calls
- [PASS] exportAsText makes no network calls

## Your data travels safely between formats

Raft's export and import functions preserve data through round-trips. Imports from OneTab, Session Buddy, Tab Session Manager, and Toby are tested. Malformed and malicious input is rejected safely.

- [PASS] complex session survives export -> re-import
- [PASS] tab groups, pins, URLs preserved through round-trip
- [PASS] multiple sessions round-trip together
- [PASS] text export creates valid OneTab format that re-imports
- [PASS] all URLs survive text export/import cycle
- [PASS] multi-window sessions use correct separators
- [PASS] OneTab data with URLs and titles
- [PASS] Session Buddy collections with pinned state
- [PASS] Tab Session Manager sessions with timestamps
- [PASS] Toby lists with custom titles
- [PASS] rejects empty input without crashing
- [PASS] rejects truncated JSON without crashing
- [PASS] rejects oversized input
- [PASS] rejects javascript: URLs in import data
- [PASS] handles mix of valid and invalid URLs gracefully

## Raft handles your biggest sessions

Scale tests verify correct behavior with 100+ tabs, 200+ tabs with 20 tab groups, 1000 stored sessions, chunked sync storage for 500+ tabs, and search across 50 sessions.

- [PASS] 100 tabs across 5 windows
- [PASS] 200 tabs with 20 tab groups
- [PASS] MAX_SESSIONS (1000) sessions stored
- [PASS] snapshot with 100+ tabs
- [PASS] chunked sync for 500+ tabs
- [PASS] searches across 50 sessions with 500+ tabs

## Your tabs are saved exactly as they were

Every property of every tab -- URL, title, favicon, pinned state, position, tab group membership, and window state -- is verified to survive capture and storage without modification.

- [PASS] preserves URLs, titles, and favicons for all tabs
- [PASS] preserves pinned state for every tab
- [PASS] preserves tab position (index) within each window
- [PASS] preserves suspended (discarded) state
- [PASS] saves and restores group names
- [PASS] saves and restores all 8 Chrome group colors
- [PASS] saves and restores collapsed/expanded state
- [PASS] maintains correct tab-to-group membership
- [PASS] handles tabs not in any group
- [PASS] saves and restores 3+ windows
- [PASS] preserves window state (normal, minimized, maximized)
- [PASS] workday setup: 3 windows, 7 groups, 27 tabs, mixed pins
- [PASS] stores session to chrome.storage and retrieves it intact
