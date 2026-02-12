# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

Only the latest version published to the Chrome Web Store receives security updates.

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

Instead, report vulnerabilities through [GitHub Security Advisories](https://github.com/raftapp/raft/security/advisories/new).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### Response timeline

- **Acknowledge** your report within 48 hours
- **Triage** within 7 days
- **Fix** critical issues within 30 days

## Security Measures

Raft is designed with a local-first, privacy-respecting architecture:

- **Client-side encryption** — Cloud sync data is encrypted with AES-256-GCM before leaving your device. Keys are derived using PBKDF2 with 100,000 iterations.
- **No analytics or telemetry** — Raft collects no usage data.
- **Local by default** — All data stays in local browser storage unless you explicitly enable Cloud Sync. This is verified by automated tests.
- **Tight CSP** — Content Security Policy uses explicit allowlists with `object-src 'none'`.
- **Minimal permissions** — See [raftapp.io/permissions](https://raftapp.io/permissions) for a full breakdown of each permission and why it's needed.

For more detail, see our [Trust page](https://raftapp.io/trust).

## Scope

### In scope

- Raft extension code (this repository)
- Encryption and key derivation implementation
- Data handling and storage
- OAuth flow and token management
- Cloud sync protocol

### Out of scope

- Chrome browser vulnerabilities (report to [Chromium](https://bugs.chromium.org/))
- Google Drive or Google OAuth service issues (report to [Google](https://about.google/intl/en/contact-google/))
- Lemon Squeezy payment platform issues
- Social engineering attacks
- Attacks requiring physical access to the device
