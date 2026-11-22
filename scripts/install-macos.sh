#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUPPORT_DIR="${HOME}/Library/Application Support/agy-quota-rings"
APP_DIR="${HOME}/Applications/Antigravity (Quota Rings).app"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Error: Node.js 22+ is required (not found in PATH)." >&2
  exit 1
fi

mkdir -p "${SUPPORT_DIR}/src"
cp "${REPO_DIR}/src/quota-rings.js" "${SUPPORT_DIR}/src/quota-rings.js"
cp "${REPO_DIR}/src/watcher.mjs" "${SUPPORT_DIR}/src/watcher.mjs"
chmod +x "${SUPPORT_DIR}/src/watcher.mjs"

mkdir -p "${APP_DIR}/Contents/MacOS"

cat > "${APP_DIR}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>Antigravity (Quota Rings)</string>
  <key>CFBundleExecutable</key>
  <string>launch-antigravity</string>
  <key>CFBundleIdentifier</key>
  <string>io.github.agy-quota-rings.launcher</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Antigravity (Quota Rings)</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

cat > "${APP_DIR}/Contents/MacOS/launch-antigravity" <<EOF
#!/usr/bin/env bash
set -euo pipefail

SUPPORT_DIR="${SUPPORT_DIR}"
NODE_BIN="${NODE_BIN}"
WATCHER="\${SUPPORT_DIR}/src/watcher.mjs"
LOG_FILE="\${SUPPORT_DIR}/launcher.log"
CDP_PORT_FILE="\${HOME}/Library/Application Support/Antigravity/DevToolsActivePort"

unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"

if [[ -s "\$CDP_PORT_FILE" ]] && /usr/bin/pgrep -f "agy-quota-rings/src/watcher.mjs" >/dev/null 2>&1; then
  /usr/bin/open -a "/Applications/Antigravity.app"
  exit 0
fi

/usr/bin/python3 - "\$NODE_BIN" "\$WATCHER" "\$LOG_FILE" <<'PY'
import os, subprocess, sys
node_bin, watcher, log_file = sys.argv[1], sys.argv[2], sys.argv[3]
with open(log_file, "ab") as lf, open(os.devnull, "rb") as devnull:
    subprocess.Popen(
        [node_bin, watcher, "--launch", "--relaunch", "--exit-on-host-close"],
        stdin=devnull,
        stdout=lf,
        stderr=lf,
        start_new_session=True,
        close_fds=True,
    )
PY

sleep 0.5
exit 0
EOF

chmod +x "${APP_DIR}/Contents/MacOS/launch-antigravity"

echo "Installed successfully!"
echo "Launcher: ${APP_DIR}"
echo "Launch Antigravity via '~/Applications/Antigravity (Quota Rings).app' (0 background daemons when closed)."
