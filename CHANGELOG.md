# Changelog

All notable changes to Raft will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.1.2] - 2026-04-26

### Security
- Bump PBKDF2 iterations from 100k to 600k (with legacy fallback for existing keys)
- Gate dev Pro-override check behind `import.meta.env.DEV`

### Internal
- Add `build-no-env` CI job to lock placeholder-injection guarantee
- Honor `keyData.iterations` on unlock (legacy 100k fallback)
- Expand hibernation-guard documentation

## [1.1.1] - 2026-04-09

### Fixed
- Fix hibernate on startup with PWAs and Chrome's tab loader

### Security
- Fix 17 Dependabot security alerts via Vite upgrade and pnpm overrides

## [1.1.0] - 2026-03-17

### Added
- Hibernate all tabs on browser start option (contributed by @eymerich)

### Security
- Fix 8 Dependabot alerts: undici (CRLF injection, HTTP smuggling, WebSocket overflow), minimatch (ReDoS), rollup (path traversal)
- Update @crxjs/vite-plugin 2.3.0 → 2.4.0

## [1.0.1] - 2025-02-23

### Fixed
- Handle expired/revoked OAuth tokens with a Reconnect flow instead of silent failure
- Fix "Remove license" link spacing in Cloud Sync panel

### Changed
- Deactivate Lemon Squeezy license on removal to keep activation counts accurate
- Add "Remove license" link to connected Cloud Sync panel

### Internal
- Increase test coverage from ~78% to 93% lines
- Add version bump scripts for patch/minor/major releases
- Fix CI code scanning alerts and migrate to codecov-action v5

## [1.0.0] - 2025-02-22

Initial release on Chrome Web Store.

- Tab suspension with custom suspended page and one-click restore
- Protection rules: pinned tabs, audible tabs, whitelisted domains
- Inactivity-based auto-suspend with configurable timeout
- Session capture and restore with tab group preservation
- Auto-save with configurable interval and slots
- Session search, import (OneTab, Session Buddy, Tab Session Manager, Toby), and export
- Cloud Sync (Pro): client-side encrypted backup to Google Drive
- Onboarding page for first-time users

[1.1.2]: https://github.com/raftapp/raft/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/raftapp/raft/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/raftapp/raft/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/raftapp/raft/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/raftapp/raft/releases/tag/v1.0.0
