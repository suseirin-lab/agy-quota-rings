# Security Policy

## Security Model

- **Local-only communication**: `src/watcher.mjs` connects strictly to `127.0.0.1` via Antigravity's local Chrome DevTools Protocol (`DevToolsActivePort`).
- **No binary patching**: Antigravity application binaries and files are never modified on disk.
- **No telemetry**: `agy-quota-rings` collects zero analytics, zero credentials, and sends no user data to external servers (the only optional external stylesheet is Google Fonts for `Google Sans` typography).

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security issue, please do **not** open a public issue with exploit details. Instead, use GitHub's **Report a vulnerability** (Private Vulnerability Reporting) feature in the repository's **Security** tab, or contact the maintainer directly.
