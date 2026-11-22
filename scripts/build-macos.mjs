// Build Universal (arm64 + x86_64) macOS installer .app and .dmg for AGY Quota Rings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIcns } from './icon-gen.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const VERSION = pkg.version || '1.1.0';

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function compileUniversalSwift(srcPath, outPath, frameworks = []) {
  const tmpArm = `${outPath}.arm64`;
  const tmpX64 = `${outPath}.x86_64`;
  const fwArgs = frameworks.flatMap((fw) => ['-framework', fw]);

  run('/usr/bin/swiftc', [
    '-O',
    '-target', 'arm64-apple-macos13.0',
    ...fwArgs,
    srcPath,
    '-o', tmpArm,
  ]);
  run('/usr/bin/swiftc', [
    '-O',
    '-target', 'x86_64-apple-macos13.0',
    ...fwArgs,
    srcPath,
    '-o', tmpX64,
  ]);
  run('/usr/bin/lipo', ['-create', tmpArm, tmpX64, '-output', outPath]);
  fs.rmSync(tmpArm, { force: true });
  fs.rmSync(tmpX64, { force: true });
  fs.chmodSync(outPath, 0o755);
}

export function buildMacosDmg({ stageOnly = false } = {}) {
  const distDir = path.join(ROOT_DIR, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const dmgName = `AGY-Quota-Rings-v${VERSION}-macOS-universal.dmg`;
  const dmgOut = path.join(distDir, dmgName);

  const stageDir = stageOnly
    ? path.join(distDir, 'macos-stage')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qr-mac-'));
  if (stageOnly) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
  }
  try {
    const dmgRoot = stageOnly ? stageDir : path.join(stageDir, 'dmg-root');
    const appDir = path.join(dmgRoot, 'AGY Quota Rings.app');
    const contentsDir = path.join(appDir, 'Contents');
    const macosDir = path.join(contentsDir, 'MacOS');
    const resDir = path.join(contentsDir, 'Resources');
    fs.mkdirSync(macosDir, { recursive: true });
    fs.mkdirSync(resDir, { recursive: true });

    // Generate crisp dual-ring ICNS icon
    const icnsBuf = buildIcns();
    fs.writeFileSync(path.join(resDir, 'AppIcon.icns'), icnsBuf);

    // Copy frontend payload
    fs.copyFileSync(path.join(ROOT_DIR, 'src', 'quota-rings.js'), path.join(resDir, 'quota-rings.js'));

    // Compile Universal Swift watcher & GUI installer
    const watcherOut = path.join(resDir, 'agy-quota-rings-watcher');
    compileUniversalSwift(
      path.join(ROOT_DIR, 'installer', 'macos', 'WatcherMain.swift'),
      watcherOut,
      ['Foundation']
    );

    const setupOut = path.join(macosDir, 'AGY Quota Rings');
    compileUniversalSwift(
      path.join(ROOT_DIR, 'installer', 'macos', 'SetupMain.swift'),
      setupOut,
      ['AppKit', 'Foundation']
    );

    const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>AGY Quota Rings</string>
  <key>CFBundleIdentifier</key>
  <string>com.suseirin.agy-quota-rings.installer</string>
  <key>CFBundleName</key>
  <string>AGY Quota Rings</string>
  <key>CFBundleDisplayName</key>
  <string>AGY Quota Rings</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
    fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist, 'utf8');

    // Ad-hoc codesign watcher and .app bundle
    run('/usr/bin/codesign', ['--force', '--sign', '-', watcherOut]);
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appDir]);

    fs.symlinkSync('/Applications', path.join(dmgRoot, 'Applications'));

    if (stageOnly) {
      console.log(`[✓] Staged Universal macOS app at ${dmgRoot}`);
      return dmgRoot;
    }

    if (fs.existsSync(dmgOut)) fs.rmSync(dmgOut, { force: true });
    run('/usr/bin/hdiutil', [
      'create',
      '-volname', `AGY Quota Rings v${VERSION}`,
      '-srcfolder', dmgRoot,
      '-ov',
      '-format', 'UDZO',
      dmgOut,
    ]);

    const stat = fs.statSync(dmgOut);
    console.log(`[✓] Built ${dmgOut} (${(stat.size / 1024).toFixed(1)} KB)`);
    return dmgOut;
  } finally {
    if (!stageOnly) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildMacosDmg({ stageOnly: process.argv.includes('--stage-only') });
}
