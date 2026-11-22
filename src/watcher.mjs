#!/usr/bin/env node
/**
 * agy-quota-rings — Standalone zero-dependency CDP watcher for Antigravity Desktop (macOS & Windows).
 * Requires Node.js 22+ (built-in WebSocket).
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Ensure local 127.0.0.1 CDP calls are never routed through proxy env vars
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.all_proxy;
delete process.env.ALL_PROXY;
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PAYLOAD = path.join(__dirname, 'quota-rings.js');

const args = new Set(process.argv.slice(2));
const FLAG_LAUNCH = args.has('--launch');
const FLAG_RELAUNCH = args.has('--relaunch');
const FLAG_EXIT_ON_CLOSE = args.has('--exit-on-host-close');
const FLAG_ONCE = args.has('--once');
const FLAG_REMOVE = args.has('--remove');
const POLL_MS = 2500;

function log(msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

function getDevToolsPortCandidates() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')];
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(appData, 'Antigravity', 'DevToolsActivePort'),
      path.join(localAppData, 'Antigravity', 'DevToolsActivePort'),
    ];
  }
  return [path.join(home, '.config', 'Antigravity', 'DevToolsActivePort')];
}

function readCdpPort() {
  for (const filePath of getDevToolsPortCandidates()) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      const firstLine = raw.split(/\r?\n/)[0]?.trim();
      const port = Number(firstLine);
      if (Number.isInteger(port) && port > 0 && port < 65536) return port;
    } catch {}
  }
  return null;
}

function findAntigravityExeWin() {
  if (process.env.ANTIGRAVITY_PATH && fs.existsSync(process.env.ANTIGRAVITY_PATH)) {
    return process.env.ANTIGRAVITY_PATH;
  }
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
    path.join(localAppData, 'Antigravity', 'Antigravity.exe'),
    path.join(programFiles, 'Antigravity', 'Antigravity.exe'),
    path.join(programFilesX86, 'Antigravity', 'Antigravity.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function isAntigravityRunning() {
  if (process.platform === 'darwin') {
    try {
      execFileSync('pgrep', ['-f', '/Antigravity.app/Contents/MacOS/Antigravity'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return out.toLowerCase().includes('antigravity.exe');
    } catch {
      return false;
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGetJson(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('CDP /json/list timeout'));
    });
    req.on('error', reject);
  });
}

function cdpSend(wsUrl, method, params = {}, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error(`CDP ${method} timeout`));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === id) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    });
    ws.addEventListener('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function ensureAntigravityWithCdp() {
  const existingPort = readCdpPort();
  if (existingPort) {
    try {
      await httpGetJson(`http://127.0.0.1:${existingPort}/json/list`, 1200);
      return;
    } catch {}
  }

  const running = isAntigravityRunning();
  if (running && !FLAG_RELAUNCH) {
    if (process.platform === 'win32') {
      log('[!] Antigravity is running without CDP. Pass --relaunch or start Antigravity.exe --remote-debugging-port=0');
    } else {
      log('[!] Antigravity is running without CDP. Pass --relaunch or run: open -a Antigravity --args --remote-debugging-port=0');
    }
    return;
  }

  if (process.platform === 'darwin') {
    if (running && FLAG_RELAUNCH) {
      log('[*] Gracefully restarting Antigravity with --remote-debugging-port=0 ...');
      try {
        execFileSync('osascript', ['-e', 'tell application "Antigravity" to quit'], { stdio: 'ignore' });
      } catch {}
      for (let i = 0; i < 30; i++) {
        if (!isAntigravityRunning()) break;
        await sleep(250);
      }
    }
    if (FLAG_LAUNCH || FLAG_RELAUNCH) {
      log('[*] Launching Antigravity with --remote-debugging-port=0 ...');
      const appPath = process.env.ANTIGRAVITY_PATH || '/Applications/Antigravity.app';
      const child = spawn('open', ['-a', appPath, '--args', '--remote-debugging-port=0'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }
    return;
  }

  if (process.platform === 'win32') {
    const exePath = findAntigravityExeWin();
    if (!exePath) {
      log('[!] Could not locate Antigravity.exe. Set ANTIGRAVITY_PATH env var to your Antigravity.exe path.');
      return;
    }
    if (running && FLAG_RELAUNCH) {
      log('[*] Gracefully restarting Antigravity.exe with --remote-debugging-port=0 ...');
      try {
        execFileSync('taskkill', ['/IM', 'Antigravity.exe'], { stdio: 'ignore', windowsHide: true });
      } catch {}
      for (let i = 0; i < 20; i++) {
        if (!isAntigravityRunning()) break;
        await sleep(250);
      }
      if (isAntigravityRunning()) {
        try {
          execFileSync('taskkill', ['/F', '/IM', 'Antigravity.exe'], { stdio: 'ignore', windowsHide: true });
        } catch {}
        for (let i = 0; i < 16; i++) {
          if (!isAntigravityRunning()) break;
          await sleep(250);
        }
      }
    }
    if (FLAG_LAUNCH || FLAG_RELAUNCH) {
      log(`[*] Launching ${exePath} --remote-debugging-port=0 ...`);
      const child = spawn(exePath, ['--remote-debugging-port=0'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    }
  }
}

async function listTargetPages(port) {
  const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
  if (!Array.isArray(targets)) return [];
  return targets.filter(
    (t) =>
      t.type === 'page' &&
      typeof t.webSocketDebuggerUrl === 'string' &&
      typeof t.url === 'string' &&
      /^https?:\/\/127\.0\.0\.1:\d+\//.test(t.url)
  );
}

const REMOVE_EXPR = `(() => {
  if (window.__agQuotaRings && typeof window.__agQuotaRings.destroy === 'function') {
    window.__agQuotaRings.destroy();
    delete window.__agQuotaRings;
  }
  document.querySelectorAll('#ag-qr-style, #ag-qr-gfont, .ag-qr-dock, .ag-qr-popover').forEach((n) => n.remove());
  return 'removed';
})()`;

async function run() {
  if (FLAG_LAUNCH || FLAG_RELAUNCH) {
    await ensureAntigravityWithCdp();
  }

  const injectedPages = new Map(); // pageId -> mtimeMs
  let seenLivePort = false;
  let missCount = 0;

  const tick = async () => {
    const port = readCdpPort();
    if (!port) {
      if (seenLivePort && FLAG_EXIT_ON_CLOSE) {
        missCount += 1;
        if (missCount >= 3) {
          log('[*] Antigravity closed; exiting managed watcher.');
          process.exit(0);
        }
      }
      return;
    }

    let pages = [];
    try {
      pages = await listTargetPages(port);
    } catch {
      if (seenLivePort && FLAG_EXIT_ON_CLOSE) {
        missCount += 1;
        if (missCount >= 3) {
          log('[*] Antigravity CDP closed; exiting managed watcher.');
          process.exit(0);
        }
      }
      return;
    }

    seenLivePort = true;
    missCount = 0;

    if (FLAG_REMOVE) {
      for (const p of pages) {
        try {
          await cdpSend(p.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: REMOVE_EXPR });
          log(`[✓] Removed agy-quota-rings from: ${p.title || p.url}`);
        } catch (err) {
          log(`[!] Remove failed on ${p.id}: ${err.message}`);
        }
      }
      process.exit(0);
    }

    let stat;
    try {
      stat = fs.statSync(DEFAULT_PAYLOAD);
    } catch (err) {
      log(`[!] Cannot read payload ${DEFAULT_PAYLOAD}: ${err.message}`);
      return;
    }

    const activeIds = new Set(pages.map((p) => p.id));
    for (const id of injectedPages.keys()) {
      if (!activeIds.has(id)) injectedPages.delete(id);
    }

    const payloadCode = fs.readFileSync(DEFAULT_PAYLOAD, 'utf8');
    for (const p of pages) {
      if (injectedPages.get(p.id) === stat.mtimeMs) continue;
      try {
        await cdpSend(p.webSocketDebuggerUrl, 'Page.addScriptToEvaluateOnNewDocument', { source: payloadCode });
        await cdpSend(p.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: payloadCode });
        injectedPages.set(p.id, stat.mtimeMs);
        log(`[✓] Injected agy-quota-rings into: ${p.title || p.url}`);
      } catch (err) {
        log(`[!] Inject failed on ${p.id}: ${err.message}`);
      }
    }

    if (FLAG_ONCE) process.exit(0);
  };

  await tick();
  if (!FLAG_ONCE && !FLAG_REMOVE) {
    setInterval(() => {
      tick().catch((err) => log(`[!] Poll error: ${err.message}`));
    }, POLL_MS);
  }
}

run().catch((err) => {
  log(`[!] Fatal: ${err.message}`);
  process.exit(1);
});
