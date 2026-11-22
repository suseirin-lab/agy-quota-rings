#!/usr/bin/env bash
set -euo pipefail

SUPPORT_DIR="${HOME}/Library/Application Support/agy-quota-rings"
APP_DIR="${HOME}/Applications/Antigravity (Quota Rings).app"

if [[ -f "${SUPPORT_DIR}/src/watcher.mjs" ]] && command -v node >/dev/null 2>&1; then
  node "${SUPPORT_DIR}/src/watcher.mjs" --remove || true
fi

pkill -f "agy-quota-rings/src/watcher.mjs" 2>/dev/null || true
rm -rf "${APP_DIR}" "${SUPPORT_DIR}"

echo "Uninstalled agy-quota-rings cleanly."
