# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-22

### Added
- Full **Windows** support in `src/watcher.mjs` (`Antigravity.exe` discovery, graceful relaunch, multi-path `DevToolsActivePort` detection, and proxy env isolation).
- Windows managed-mode installer and uninstaller (`scripts/install-windows.ps1`, `scripts/uninstall-windows.ps1`) with silent WScript launcher and Desktop/Start Menu shortcuts.
- GitHub open-source community health files (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates, and GitHub Actions CI).

### Changed
- Concise `README.md` focused on plugin purpose and cross-platform setup.
- Added Windows fallback fonts (`Microsoft YaHei UI`, `Segoe UI`) alongside `Google Sans` while keeping identical Material 3 styling across macOS and Windows.

## [1.0.0] - 2026-11-22

### Added
- Initial standalone release with Material 3 dual-ring UI (`5h` + `Weekly`), Google Sans typography, automatic dark/light background adaptation, smooth segmented pool switcher, and zero-dependency Node.js 22+ CDP watcher for macOS.
