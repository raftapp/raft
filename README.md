<p align="center">
  <img src="public/mascot/awake-together.png" alt="Shells the otter keeping watch" width="280" />
</p>

<h1 align="center">Raft</h1>

<p align="center">
  <a href="https://github.com/raftapp/raft/actions"><img src="https://github.com/raftapp/raft/actions/workflows/build.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/raftapp/raft"><img src="https://codecov.io/gh/raftapp/raft/graph/badge.svg" alt="codecov" /></a>
</p>

<p align="center"><strong>Keep your tabs safe.</strong> A Chrome extension for tab suspension and session management.</p>

<p align="center"><a href="https://raftapp.io">raftapp.io</a> &middot; <a href="https://raftapp.io/trust">My Promise</a></p>

Named after the way otters hold hands while sleeping to stay together — a group of otters is called a *raft*. Our mascot **Shells** keeps watch over your tabs, making sure they stay safe and connected.

## Features

**Tab Suspension**
- Auto-suspend inactive tabs using Chrome's native tab discarding
- Protection rules: pinned tabs, audio, whitelisted sites always safe
- Custom suspended page with one-click restore
- Manual suspend via popup, context menu, or keyboard shortcut
- Close duplicate tabs across all windows with intelligent keep-best logic

**Session Management**
- Capture every window, tab, and tab group
- Tab group preservation: names, colors, collapsed state
- Selective restore: expand a session and pick individual tabs or windows
- Restore sessions as suspended to save memory
- Auto-save on configurable schedule
- Search across sessions by title or URL
- Organize sessions into folders

**Backup & Recovery**
- Multi-layer backup: auto-save, recovery snapshots (rotating last 5), browser sync
- Backup health monitor in popup and options with actionable suggestions
- Export sessions as JSON or text
- Import from OneTab, Session Buddy, Tab Session Manager, Toby

**Cloud Sync (Pro)**
- End-to-end encryption (AES-256-GCM with PBKDF2)
- Google Drive integration via private app-data folder
- One-time $25 purchase — no subscriptions

## Trust Report

### Encryption

All cloud-synced data is encrypted on your device before it leaves. Raft uses **AES-256-GCM** with a unique 96-bit IV per encryption operation. Encryption keys are derived from your password using **PBKDF2 with 100,000 iterations** (SHA-256). Your recovery key is shown once during setup and is never stored. OAuth uses **PKCE (S256)** to protect the authorization flow, and tokens are encrypted at rest with your password.

See [Privacy Policy](https://raftapp.io/privacy) for full details.

### Privacy

Raft collects **zero analytics, telemetry, or usage data**. Eight automated tests verify that no `fetch()` or `XMLHttpRequest` calls exist in the save, restore, import, or export code paths — your session data never touches a network unless you explicitly enable cloud sync.

The extension's Content Security Policy restricts all network access to `googleapis.com` (for cloud sync) and `api.lemonsqueezy.com` (for license validation). No other outbound connections are possible.

See [Privacy Policy](https://raftapp.io/privacy).

### Automated Safety Tests

Raft's data safety claims are backed by automated tests covering crash recovery, network isolation, import/export integrity, scale limits, and tab fidelity. Run `pnpm test:trust-report` to generate the full report yourself.

See the [generated safety report](docs/SAFETY-REPORT.md) for details.

### Permissions

Raft requests only five permissions, each with a specific purpose:

| Permission | Why |
|------------|-----|
| `tabs` | Read tab URLs/titles to save sessions and identify inactive tabs |
| `storage` | Persist sessions and settings to `chrome.storage.local` |
| `alarms` | Run periodic checks for auto-suspend and auto-save |
| `contextMenus` | Add "Suspend tab" to the right-click menu |
| `identity` | Google OAuth for cloud sync (Pro only) |

**Not requested:** `history`, `bookmarks`, `webRequest`, `<all_urls>`, `notifications`. See [Permissions Explained](https://raftapp.io/permissions) for full details.

### Open Source

Raft's source code is available for inspection. Every claim in this trust report can be verified by reading the code or running the tests.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Alt+Shift+S | Suspend current tab |
| Alt+Shift+O | Suspend other tabs in window |
| Alt+Shift+D | Close duplicate tabs |

## Tech Stack

- **Build**: Vite + CRXJS
- **UI**: Preact + TailwindCSS v4
- **State**: Zustand
- **Testing**: Vitest
- **Language**: TypeScript

## Installation

```bash
pnpm install
pnpm build
```

Then load the `dist/` folder as an unpacked extension in Chrome.

## Development

```bash
pnpm dev          # Start dev server with HMR
pnpm build        # Build for production
pnpm test         # Run tests
pnpm test:coverage # Run tests with coverage
pnpm typecheck    # Type check
pnpm lint         # Lint
```

## OAuth Setup

Google OAuth credentials are injected at build time from a `.env` file.

```bash
cp .env.example .env
# Edit .env with your Google Cloud OAuth client ID and secret
```

Create credentials at the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — choose "OAuth 2.0 Client ID" for a Web application, enable the Drive API, and configure the consent screen. See `.env.example` for the required variables.

The OAuth flow is additionally protected by PKCE (S256).

## License

MIT
