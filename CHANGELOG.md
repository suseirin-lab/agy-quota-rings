# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-11-23

### Added
- **Real-time model auto-follow**: watches `[data-testid="model-selector-trigger"]` and conversation switches so changing models (e.g. `Gemini 4 Argon`, `Gemini 4 Neon`, `Claude`, `GPT`) or switching conversations immediately updates the displayed quota pool.
- **GPL-3.0 compliant hot-update push**: macOS, Windows, and Node.js watchers check GitHub Releases for newer open-source `quota-rings.js` releases, validate and atomically update the local payload, and hot-inject into open Antigravity windows without restarting. Supports `--no-auto-update`, `AGY_QR_NO_AUTO_UPDATE=1`, and custom fork override via `AGY_QR_UPDATE_REPO`.

### Changed
- Relicensed project from MIT to **GNU General Public License v3.0 (GPL-3.0-only)**.
- Improved quota pool matching for `Gemini 4 Argon` vs. `Gemini Models` (using group descriptions and strict Argon isolation).

## [1.1.0] - 2026-11-22

### Added
- Standalone zero-Node.js GUI installers for **Windows x64 (`.exe`)** and **macOS Universal (`.dmg`)** with minimalist two-mode setup:
  - **随 Antigravity 启动（托管模式）**: launches alongside Antigravity and exits automatically when closed.
  - **后台常驻监听（常驻模式）**: runs silently on startup and auto-injects into stock Antigravity.
- Floating secondary model selector popover above the main card (`position: absolute`) with full model names and quick-step switching.
- Compact Material Design 3 + Google Sans dimensions (`36px` dock pill with `28px` 5h ring + `20px` weekly ring; `214px` popover card).

### Fixed
- Fixed vertical jumping when toggling the secondary model selector by anchoring the primary popover to `bottom` and isolating the model list in a floating layer.
- Fixed highlight slider initial jump when opening the model selector.

## [1.0.0] - 2026-11-22

### Added
- Initial release of `agy-quota-rings` with standalone CDP watcher and macOS/Windows installation scripts.
