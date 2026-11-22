(function (root) {
  'use strict';

  const STYLE_ID = 'ag-qr-style';
  const GFONT_LINK_ID = 'ag-qr-gfont';
  const GFONT_URL =
    'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Google+Sans+Flex:opsz,wght@6..144,300..800&display=swap';
  const DOCK_CLASS = 'ag-qr-dock';
  const POPOVER_CLASS = 'ag-qr-popover';
  const STORAGE_BOTTOM_KEY = 'ag_qr_bottom_px';
  const STORAGE_PINNED_POOL_KEY = 'ag_qr_pinned_pool';
  const POLL_MS = 30000;
  const QUOTA_TTL_MS = 25000;

  // Tear down any previous instance cleanly (supports hot-reload & coexistence)
  if (root.__agQuotaRings && typeof root.__agQuotaRings.destroy === 'function') {
    try {
      root.__agQuotaRings.destroy();
    } catch {}
    delete root.__agQuotaRings;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function toEpochSeconds(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts > 1e12 ? ts / 1000 : ts;
    if (typeof ts === 'string') {
      const ms = Date.parse(ts);
      return Number.isFinite(ms) ? ms / 1000 : 0;
    }
    if (typeof ts === 'object') {
      const s = Number(ts.seconds ?? ts.sec ?? 0);
      if (Number.isFinite(s) && s > 0) return s;
    }
    return 0;
  }

  function formatReset(bucket) {
    if (!bucket) return '—';
    if (bucket.resetIn) return bucket.resetIn;
    const sec = Number(bucket.resetSeconds || 0);
    if (!sec) return '—';
    const diff = Math.max(0, sec - Math.floor(Date.now() / 1000));
    if (diff <= 0) return '即将重置';
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (d > 0) return `${d}天${h}小时后重置`;
    if (h > 0) return `${h}小时${m}分后重置`;
    return `${Math.max(1, m)}分钟后重置`;
  }

  // ── Standalone Quota Provider (works with or without AGY Claude Style) ────
  const standaloneState = {
    svc: null,
    store: null,
    cachedQuotaData: null,
    lastFetchAt: 0,
    inflight: null,
  };

  function isRootAppStore(store) {
    if (!store || typeof store.getState !== 'function') return false;
    try {
      const st = store.getState();
      return Boolean(st && typeof st === 'object' && ('userStatus' in st || 'cascadeModelConfigData' in st || 'credits' in st));
    } catch {
      return false;
    }
  }

  function discoverHooks() {
    if (standaloneState.svc && standaloneState.store) {
      return { svc: standaloneState.svc, store: standaloneState.store };
    }
    const anchors = document.querySelectorAll(
      '[data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="agent-response"], [data-testid="conversation-row-sidebar"], [data-testid="new-conversation-button"], [data-testid="home-greeting"]'
    );
    let bestStore = isRootAppStore(standaloneState.store) ? standaloneState.store : null;
    let fallbackStore = standaloneState.store || null;

    for (const el of anchors) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && el[key]; f && !(standaloneState.svc && bestStore); f = f.return) {
        const p = f.memoizedProps;
        if (p && p.store && typeof p.store.getState === 'function') {
          if (isRootAppStore(p.store)) bestStore = bestStore || p.store;
          else if (!fallbackStore) fallbackStore = p.store;
        }
        for (let d = f.dependencies && f.dependencies.firstContext; d; d = d.next) {
          const v = d.memoizedValue;
          if (!v || typeof v !== 'object') continue;
          if (!standaloneState.svc && typeof v.retrieveUserQuotaSummary === 'function') {
            standaloneState.svc = v;
          }
          if (v.store && typeof v.store.getState === 'function') {
            if (isRootAppStore(v.store)) bestStore = bestStore || v.store;
            else if (!fallbackStore) fallbackStore = v.store;
          }
        }
      }
      if (standaloneState.svc && bestStore) break;
    }
    standaloneState.store = bestStore || fallbackStore;
    if (standaloneState.svc || standaloneState.store) {
      return { svc: standaloneState.svc, store: standaloneState.store };
    }
    return null;
  }

  function getCurrentModelLabel() {
    const btn = document.querySelector('[data-testid="model-selector-trigger"]');
    if (!btn) return '';
    const aria = btn.getAttribute('aria-label') || '';
    const m = aria.match(/(?:当前|目前|现在|現在|Current)[：:]\s*(.+)$/i);
    if (m && m[1]) return m[1].trim();
    return (btn.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeStandaloneQuota(quotaRes, storeState) {
    const userStatus = storeState?.userStatus ? storeState.userStatus : storeState;
    const rawGroups = quotaRes?.response?.groups || quotaRes?.groups || [];
    const groups = rawGroups.map((g) => {
      const name = String(g.displayName || g.name || '');
      const buckets = (g.buckets || []).map((b) => {
        const resetSeconds = Math.floor(toEpochSeconds(b.resetTime));
        let remainingPct = null;
        if (b.remaining?.case === 'remainingFraction') {
          remainingPct = clamp(Number(b.remaining.value || 0) * 100, 0, 100);
        } else if (typeof b.remainingPct === 'number') {
          remainingPct = clamp(b.remainingPct, 0, 100);
        }
        return {
          id: String(b.bucketId || ''),
          name: String(b.displayName || ''),
          window: String(b.window || ''),
          disabled: Boolean(b.disabled),
          remainingPct,
          resetSeconds,
        };
      });
      const b5h = buckets.find((b) => b.window.toLowerCase() === '5h') || null;
      const bWeek = buckets.find((b) => b.window.toLowerCase() === 'weekly') || buckets.find((b) => b !== b5h) || null;
      const enabledPcts = buckets.filter((b) => !b.disabled && typeof b.remainingPct === 'number').map((b) => b.remainingPct);
      const anyPcts = buckets.filter((b) => typeof b.remainingPct === 'number').map((b) => b.remainingPct);
      const effectiveRemainingPct = enabledPcts.length
        ? Math.min(...enabledPcts)
        : anyPcts.length
        ? Math.min(...anyPcts)
        : null;
      return { name, groupName: name, buckets, b5h, bWeek, effectiveRemainingPct };
    });

    if (groups.length === 0) {
      const configs = userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
      const seen = new Map();
      for (const m of configs) {
        if (m.disabled || typeof m.quotaInfo?.remainingFraction !== 'number') continue;
        const label = String(m.label || '');
        const family = label.replace(/\s*\((?:Low|Medium|High|XHigh|Max)\)\s*$/i, '').trim() || label;
        if (seen.has(family)) continue;
        const pct = clamp(Number(m.quotaInfo.remainingFraction) * 100, 0, 100);
        const resetSeconds = Math.floor(toEpochSeconds(m.quotaInfo?.resetTime));
        const bWeek = { id: String(m.modelId || 'model'), name: family, window: 'weekly', disabled: false, remainingPct: pct, resetSeconds };
        seen.set(family, { name: family, groupName: family, buckets: [bWeek], b5h: null, bWeek, effectiveRemainingPct: pct });
      }
      groups.push(...seen.values());
    }
    return { groups };
  }

  function matchActiveGroup(quotaData, modelLabel) {
    const groups = quotaData?.groups || [];
    if (!groups.length) return null;
    const lower = String(modelLabel || '').toLowerCase();
    if (lower) {
      if (lower.includes('argon')) {
        const hit = groups.find((g) => /argon/i.test(g.name));
        if (hit) return hit;
      }
      if (/claude|gpt|sonnet|opus/i.test(lower)) {
        const hit = groups.find((g) => /claude|gpt|sonnet|opus/i.test(g.name));
        if (hit) return hit;
      }
      let best = null;
      let bestLen = 0;
      for (const g of groups) {
        const gn = String(g.name || '').trim().toLowerCase();
        if (gn && lower.includes(gn) && gn.length > bestLen) {
          best = g;
          bestLen = gn.length;
        }
      }
      if (best) return best;
    }
    return groups.find((g) => /gemini/i.test(g.name) && !/argon/i.test(g.name)) || groups[0];
  }

  function getQuotaSnapshot() {
    // Reuse AGY Claude Style cache if present so both coexist cleanly with zero duplicate requests
    const hostApi = root.__agClaudeStyle;
    if (hostApi && typeof hostApi.getQuotaSnapshot === 'function') {
      const snap = hostApi.getQuotaSnapshot();
      if (snap && snap.quotaData) return snap;
    }
    const modelLabel = getCurrentModelLabel();
    return {
      quotaData: standaloneState.cachedQuotaData,
      activeQuota: matchActiveGroup(standaloneState.cachedQuotaData, modelLabel),
      modelLabel,
    };
  }

  async function refreshQuota(force) {
    const hostApi = root.__agClaudeStyle;
    if (hostApi && typeof hostApi.refreshQuota === 'function') {
      try {
        const snap = await hostApi.refreshQuota(Boolean(force));
        if (snap && snap.quotaData) return snap;
      } catch {}
    }

    const now = Date.now();
    if (!force && standaloneState.cachedQuotaData && now - standaloneState.lastFetchAt < QUOTA_TTL_MS) {
      return getQuotaSnapshot();
    }
    if (standaloneState.inflight) return standaloneState.inflight;

    standaloneState.inflight = (async () => {
      try {
        const h = discoverHooks();
        if (!h) return getQuotaSnapshot();
        let raw = null;
        if (typeof h.svc?.retrieveUserQuotaSummary === 'function') {
          raw = await h.svc.retrieveUserQuotaSummary({});
        }
        const st = typeof h.store?.getState === 'function' ? h.store.getState() : null;
        standaloneState.cachedQuotaData = normalizeStandaloneQuota(raw, st);
        standaloneState.lastFetchAt = Date.now();
      } catch {} finally {
        standaloneState.inflight = null;
      }
      return getQuotaSnapshot();
    })();
    return standaloneState.inflight;
  }

  // ── Theme Detection & Material 3 Palette ──────────────────────────────────
  function parseRgbLuminance(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') return null;
    const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (alpha < 0.15) return null;
    return 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
  }

  function detectLightTheme() {
    const html = document.documentElement;
    const body = document.body;
    const cls = `${html?.className || ''} ${body?.className || ''}`.toLowerCase();
    const themeAttr = (body?.getAttribute('data-agy-theme') || html?.getAttribute('data-theme') || '').toLowerCase();
    if (themeAttr.includes('light') || /\b(theme-light|light-theme|light)\b/.test(cls)) return true;
    if (themeAttr.includes('dark') || /\b(theme-dark|dark-theme|dark)\b/.test(cls)) return false;
    try {
      const split = document.querySelector('[data-testid="sidebar-split"]');
      for (const el of [split?.firstElementChild, body, html]) {
        if (!el) continue;
        const lum = parseRgbLuminance(getComputedStyle(el).backgroundColor);
        if (lum !== null) return lum > 148;
      }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return true;
    } catch {}
    return false;
  }

  function ringColor(pct, kind, blockedByWeekly, light) {
    if (blockedByWeekly) return light ? '#d93025' : '#f28b82';
    if (typeof pct !== 'number' || !Number.isFinite(pct)) {
      return light ? 'rgba(60, 64, 67, 0.28)' : 'rgba(232, 234, 237, 0.28)';
    }
    if (pct <= 15) return light ? '#d93025' : '#f28b82';
    if (pct <= 35) return light ? '#e37400' : '#fdd663';
    if (kind === 'weekly') return light ? '#1e8e3e' : '#81c995';
    return light ? '#1a73e8' : '#8ab4f8';
  }

  const REFRESH_ICON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;

  function injectStyles() {
    if (!document.getElementById(GFONT_LINK_ID)) {
      const linkEl = document.createElement('link');
      linkEl.id = GFONT_LINK_ID;
      linkEl.rel = 'stylesheet';
      linkEl.href = GFONT_URL;
      (document.head || document.documentElement).appendChild(linkEl);
    }
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = `
      .${DOCK_CLASS} {
        --qr-fg: var(--foreground, var(--ag-sidebar-text-strong, #e8eaed));
        --qr-muted: var(--muted-foreground, var(--ag-sidebar-label, #9aa0a6));
        --qr-base: var(--ag-cs-sidebar, var(--sidebar, var(--background, #13161d)));
        --qr-surface: color-mix(in srgb, var(--qr-fg) 5%, var(--qr-base));
        --qr-surface-hover: color-mix(in srgb, var(--qr-fg) 9%, var(--qr-base));
        --qr-outline: color-mix(in srgb, var(--qr-fg) 11%, transparent);
        --qr-outline-strong: color-mix(in srgb, var(--qr-fg) 22%, transparent);
        --qr-track: color-mix(in srgb, var(--qr-fg) 12%, transparent);
        --qr-accent: #8ab4f8;

        position: fixed;
        left: 10px;
        bottom: 58px;
        z-index: 2147483000;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        width: 44px;
        padding: 6px 5px 8px;
        border-radius: 9999px;
        background: var(--qr-surface);
        border: 1px solid var(--qr-outline);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16), 0 6px 14px rgba(0, 0, 0, 0.12);
        color: var(--qr-fg);
        user-select: none;
        cursor: pointer;
        will-change: transform, opacity;
        transition:
          transform 0.18s cubic-bezier(0.2, 0, 0, 1),
          background-color 0.18s cubic-bezier(0.2, 0, 0, 1),
          border-color 0.18s cubic-bezier(0.2, 0, 0, 1),
          opacity 0.18s cubic-bezier(0.2, 0, 0, 1);
        font-family: "Google Sans", "Google Sans Flex", "Google Sans Text", var(--font-sans, "PingFang SC", -apple-system, sans-serif);
        -webkit-font-smoothing: antialiased;
      }
      .${DOCK_CLASS}[data-light="1"] {
        --qr-fg: var(--foreground, var(--ag-sidebar-text-strong, #202124));
        --qr-muted: var(--muted-foreground, var(--ag-sidebar-label, #5f6368));
        --qr-base: var(--ag-cs-sidebar, var(--sidebar, var(--background, #f8f9fa)));
        --qr-surface: color-mix(in srgb, var(--card, #ffffff) 90%, var(--qr-base));
        --qr-surface-hover: color-mix(in srgb, var(--qr-fg) 4%, var(--card, #ffffff));
        --qr-outline: color-mix(in srgb, var(--qr-fg) 12%, transparent);
        --qr-outline-strong: color-mix(in srgb, var(--qr-fg) 22%, transparent);
        --qr-track: color-mix(in srgb, var(--qr-fg) 11%, transparent);
        --qr-accent: #1a73e8;
        box-shadow: 0 1px 2px rgba(60, 64, 67, 0.14), 0 4px 12px rgba(60, 64, 67, 0.1);
      }
      .${DOCK_CLASS}[data-collapsed="1"] {
        opacity: 0.72;
      }
      .${DOCK_CLASS}:hover {
        opacity: 1;
        background: var(--qr-surface-hover);
        border-color: var(--qr-outline-strong);
      }
      .${DOCK_CLASS}:active {
        transform: scale(0.96);
      }
      .${DOCK_CLASS}[data-open="1"] {
        opacity: 1;
        background: var(--qr-surface-hover);
        border-color: color-mix(in srgb, var(--qr-accent) 55%, var(--qr-outline));
      }
      .${DOCK_CLASS} .ag-qr-grip {
        width: 14px;
        height: 2.5px;
        border-radius: 9999px;
        background: var(--qr-muted);
        opacity: 0;
        cursor: ns-resize;
        transition: opacity 0.16s cubic-bezier(0.2, 0, 0, 1);
      }
      .${DOCK_CLASS}:hover .ag-qr-grip {
        opacity: 0.45;
      }
      .${DOCK_CLASS} .ag-qr-ring-box {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        pointer-events: none;
      }
      .${DOCK_CLASS} .ag-qr-ring-box.is-5h {
        width: 32px;
        height: 32px;
      }
      .${DOCK_CLASS} .ag-qr-ring-box.is-week {
        width: 22px;
        height: 22px;
      }
      .${DOCK_CLASS} svg,
      .${POPOVER_CLASS} .ag-qr-meter-ring svg {
        display: block;
        transform: rotate(-90deg);
        overflow: visible;
      }
      .${DOCK_CLASS} .ag-qr-track,
      .${POPOVER_CLASS} .ag-qr-track {
        stroke: var(--qr-track);
      }
      .${DOCK_CLASS} .ag-qr-arc,
      .${POPOVER_CLASS} .ag-qr-arc {
        transition:
          stroke-dashoffset 0.38s cubic-bezier(0.2, 0, 0, 1),
          stroke 0.24s cubic-bezier(0.2, 0, 0, 1);
      }
      .${DOCK_CLASS} .ag-qr-num {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        letter-spacing: -0.02em;
        transition: color 0.22s ease;
      }
      .${DOCK_CLASS} .ag-qr-ring-box.is-5h .ag-qr-num {
        font-size: 9.5px;
      }
      .${DOCK_CLASS} .ag-qr-ring-box.is-week .ag-qr-num {
        font-size: 7.5px;
      }

      .${POPOVER_CLASS} {
        --qr-fg: var(--foreground, var(--ag-sidebar-text-strong, #e8eaed));
        --qr-muted: var(--muted-foreground, var(--ag-sidebar-label, #9aa0a6));
        --qr-card-base: var(--card, var(--ag-cs-composer-bg, var(--ag-cs-sidebar, #1b1e26)));
        --qr-surface: color-mix(in srgb, var(--qr-fg) 4%, var(--qr-card-base));
        --qr-seg-bg: color-mix(in srgb, var(--qr-fg) 6%, transparent);
        --qr-hover: var(--ag-cs-hover-wash, color-mix(in srgb, var(--qr-fg) 8%, transparent));
        --qr-outline: var(--ag-cs-border-1, color-mix(in srgb, var(--qr-fg) 11%, transparent));
        --qr-track: color-mix(in srgb, var(--qr-fg) 11%, transparent);
        --qr-accent: #8ab4f8;
        --qr-accent-tonal: color-mix(in srgb, #8ab4f8 20%, transparent);

        position: fixed;
        z-index: 2147483001;
        width: 256px;
        border-radius: 20px;
        padding: 14px 16px 15px;
        background: var(--qr-surface);
        border: 1px solid var(--qr-outline);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3), 0 10px 28px rgba(0, 0, 0, 0.24);
        color: var(--qr-fg);
        font-family: "Google Sans", "Google Sans Flex", "Google Sans Text", var(--font-sans, "PingFang SC", -apple-system, sans-serif);
        font-size: 12.5px;
        line-height: 1.4;
        -webkit-font-smoothing: antialiased;
        opacity: 0;
        transform: translateX(-6px) scale(0.97);
        transform-origin: left bottom;
        pointer-events: none;
        will-change: transform, opacity;
        transition:
          opacity 0.16s cubic-bezier(0.05, 0.7, 0.1, 1),
          transform 0.2s cubic-bezier(0.05, 0.7, 0.1, 1);
      }
      .${POPOVER_CLASS}[data-visible="1"] {
        opacity: 1;
        transform: translateX(0) scale(1);
        pointer-events: auto;
      }
      .${POPOVER_CLASS}[data-light="1"] {
        --qr-fg: var(--foreground, var(--ag-sidebar-text-strong, #202124));
        --qr-muted: var(--muted-foreground, var(--ag-sidebar-label, #5f6368));
        --qr-card-base: var(--card, var(--ag-cs-composer-bg, #ffffff));
        --qr-surface: color-mix(in srgb, var(--qr-card-base) 98%, var(--ag-cs-sidebar, #f8f9fa));
        --qr-seg-bg: color-mix(in srgb, var(--qr-fg) 5%, transparent);
        --qr-hover: color-mix(in srgb, var(--qr-fg) 6%, transparent);
        --qr-outline: color-mix(in srgb, var(--qr-fg) 11%, transparent);
        --qr-track: color-mix(in srgb, var(--qr-fg) 10%, transparent);
        --qr-accent: #1a73e8;
        --qr-accent-tonal: rgba(26, 115, 232, 0.13);
        box-shadow: 0 1px 2px rgba(60, 64, 67, 0.16), 0 6px 20px rgba(60, 64, 67, 0.14);
      }
      .${POPOVER_CLASS} .ag-qr-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 11px;
      }
      .${POPOVER_CLASS} .ag-qr-title {
        font-size: 13.5px;
        font-weight: 500;
        letter-spacing: -0.01em;
      }
      .${POPOVER_CLASS} .ag-qr-refresh {
        appearance: none;
        border: none;
        background: transparent;
        color: var(--qr-muted);
        width: 28px;
        height: 28px;
        margin: -4px -4px -4px 0;
        border-radius: 9999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition:
          color 0.15s ease,
          background-color 0.15s ease,
          transform 0.14s cubic-bezier(0.2, 0, 0, 1);
      }
      .${POPOVER_CLASS} .ag-qr-refresh:hover {
        color: var(--qr-fg);
        background: var(--qr-hover);
      }
      .${POPOVER_CLASS} .ag-qr-refresh:active {
        transform: scale(0.88);
      }
      .${POPOVER_CLASS} .ag-qr-refresh.is-spin svg {
        animation: agQrSpin 0.75s linear infinite;
      }
      @keyframes agQrSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .${POPOVER_CLASS} .ag-qr-pool-bar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 3px;
        margin-bottom: 13px;
        border-radius: 12px;
        background: var(--qr-seg-bg);
      }
      .${POPOVER_CLASS} .ag-qr-pool-bar[hidden] {
        display: none;
      }
      .${POPOVER_CLASS} .ag-qr-pool-slider {
        position: absolute;
        top: 3px;
        bottom: 3px;
        left: 0;
        border-radius: 9px;
        background: var(--qr-accent-tonal);
        pointer-events: none;
        will-change: transform, width;
        transition:
          transform 0.24s cubic-bezier(0.2, 0, 0, 1),
          width 0.24s cubic-bezier(0.2, 0, 0, 1),
          opacity 0.18s ease;
      }
      .${POPOVER_CLASS} .ag-qr-pool-tab {
        position: relative;
        z-index: 1;
        flex: 1 1 0;
        min-width: 0;
        appearance: none;
        border: none;
        background: transparent;
        color: var(--qr-muted);
        border-radius: 9px;
        padding: 4px 7px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        transition:
          color 0.2s cubic-bezier(0.2, 0, 0, 1),
          transform 0.14s cubic-bezier(0.2, 0, 0, 1);
      }
      .${POPOVER_CLASS} .ag-qr-pool-tab:hover {
        color: var(--qr-fg);
      }
      .${POPOVER_CLASS} .ag-qr-pool-tab:active {
        transform: scale(0.95);
      }
      .${POPOVER_CLASS} .ag-qr-pool-tab.is-active {
        color: var(--qr-accent);
      }
      .${POPOVER_CLASS} .ag-qr-meter-list {
        display: flex;
        flex-direction: column;
        gap: 13px;
      }
      .${POPOVER_CLASS} .ag-qr-meter {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .${POPOVER_CLASS} .ag-qr-meter-ring {
        position: relative;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .${POPOVER_CLASS} .ag-qr-meter-body {
        flex: 1;
        min-width: 0;
      }
      .${POPOVER_CLASS} .ag-qr-meter-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 5px;
        font-variant-numeric: tabular-nums;
      }
      .${POPOVER_CLASS} .ag-qr-meter-name {
        font-size: 12px;
        font-weight: 500;
      }
      .${POPOVER_CLASS} .ag-qr-meter-val {
        font-size: 12px;
        font-weight: 500;
        transition: color 0.22s ease;
      }
      .${POPOVER_CLASS} .ag-qr-bar {
        height: 4px;
        border-radius: 9999px;
        background: var(--qr-track);
        overflow: hidden;
        margin-bottom: 4px;
      }
      .${POPOVER_CLASS} .ag-qr-bar > span {
        display: block;
        height: 100%;
        border-radius: 9999px;
        will-change: width;
        transition:
          width 0.36s cubic-bezier(0.2, 0, 0, 1),
          background-color 0.24s cubic-bezier(0.2, 0, 0, 1);
      }
      .${POPOVER_CLASS} .ag-qr-meter-sub {
        font-size: 10.5px;
        color: var(--qr-muted);
        font-variant-numeric: tabular-nums;
      }
    `;
  }

  function createRingDom(size, radius, strokeWidth, withNum) {
    const NS = 'http://www.w3.org/2000/svg';
    const cx = size / 2;
    const cy = size / 2;
    const circ = 2 * Math.PI * radius;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('aria-hidden', 'true');

    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('class', 'ag-qr-track');
    track.setAttribute('cx', String(cx));
    track.setAttribute('cy', String(cy));
    track.setAttribute('r', String(radius));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke-width', String(strokeWidth));

    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('class', 'ag-qr-arc');
    arc.setAttribute('cx', String(cx));
    arc.setAttribute('cy', String(cy));
    arc.setAttribute('r', String(radius));
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke-width', String(strokeWidth));
    arc.setAttribute('stroke-dasharray', circ.toFixed(2));
    arc.setAttribute('stroke-dashoffset', circ.toFixed(2));
    arc.setAttribute('stroke-linecap', 'round');

    svg.appendChild(track);
    svg.appendChild(arc);

    let numEl = null;
    if (withNum) {
      numEl = document.createElement('span');
      numEl.className = 'ag-qr-num';
      numEl.textContent = '--';
    }

    return {
      svg,
      numEl,
      update(pct, color) {
        const hasVal = typeof pct === 'number' && Number.isFinite(pct);
        const ratio = hasVal ? clamp(pct, 0, 100) / 100 : 0;
        const offset = circ * (1 - ratio);
        arc.setAttribute('stroke', color);
        arc.setAttribute('stroke-dashoffset', offset.toFixed(2));
        if (numEl) {
          numEl.textContent = hasVal ? `${Math.round(pct)}` : '--';
          numEl.style.color = hasVal ? color : 'var(--qr-muted)';
        }
      },
    };
  }

  function selectDisplayGroup(quotaSnap, pinnedGroupName) {
    const groups = Array.isArray(quotaSnap?.quotaData?.groups) ? quotaSnap.quotaData.groups : [];
    if (pinnedGroupName) {
      const pinned = groups.find((g) => g.groupName === pinnedGroupName || g.name === pinnedGroupName);
      if (pinned) return pinned;
    }
    if (quotaSnap?.activeQuota) {
      const matched = groups.find(
        (g) => g.groupName === quotaSnap.activeQuota.groupName || g.name === quotaSnap.activeQuota.groupName
      );
      return matched || quotaSnap.activeQuota;
    }
    if (groups.length > 0) {
      return groups.find((g) => g.b5h && !g.b5h.disabled) || groups[0];
    }
    return null;
  }

  function extractBuckets(group) {
    if (!group) {
      return { b5h: null, bWeek: null, pct5h: null, pctWeek: null, blockedByWeekly: false };
    }
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    const b5h =
      (group.b5h && String(group.b5h.window || '').toLowerCase() === '5h' ? group.b5h : null) ||
      buckets.find((b) => String(b.window || '').toLowerCase() === '5h') ||
      null;
    const rawWeek =
      (group.bWeek && group.bWeek !== b5h && String(group.bWeek.window || '').toLowerCase() !== '5h' ? group.bWeek : null) ||
      buckets.find((b) => String(b.window || '').toLowerCase() === 'weekly') ||
      buckets.find((b) => b !== b5h) ||
      null;

    const pct5h =
      b5h && !b5h.disabled && typeof b5h.remainingPct === 'number'
        ? clamp(b5h.remainingPct, 0, 100)
        : null;
    const pctWeek =
      rawWeek && !rawWeek.disabled && typeof rawWeek.remainingPct === 'number'
        ? clamp(rawWeek.remainingPct, 0, 100)
        : !b5h && typeof group.effectiveRemainingPct === 'number'
        ? clamp(group.effectiveRemainingPct, 0, 100)
        : null;

    const blockedByWeekly = pctWeek !== null && pctWeek <= 0.05;
    return { b5h, bWeek: rawWeek, pct5h, pctWeek, blockedByWeekly };
  }

  function createInstance() {
    let destroyed = false;
    let dockEl = null;
    let dockRing5h = null;
    let dockRingWeek = null;

    let popoverEl = null;
    let popRefs = null;
    let popOpen = false;
    let popCloseTimer = null;

    let pollTimer = null;
    let retryTimer = null;
    let resizeObs = null;
    let themeObs = null;
    let mediaQuery = null;
    let posRaf = 0;
    let themeRaf = 0;
    let cachedLight = detectLightTheme();
    let isRefreshing = false;
    let pinnedPool = '';
    try {
      pinnedPool = localStorage.getItem(STORAGE_PINNED_POOL_KEY) || '';
    } catch {}

    function readBottomPx() {
      try {
        const raw = Number(localStorage.getItem(STORAGE_BOTTOM_KEY));
        if (Number.isFinite(raw) && raw >= 12 && raw <= window.innerHeight - 96) return raw;
      } catch {}
      return 58;
    }

    function saveBottomPx(px) {
      try {
        localStorage.setItem(STORAGE_BOTTOM_KEY, String(Math.round(px)));
      } catch {}
    }

    function applyDockPosition() {
      posRaf = 0;
      if (destroyed || !dockEl || !dockEl.isConnected) return;
      const split = document.querySelector('[data-testid="sidebar-split"]');
      const sidebar = split ? split.firstElementChild : null;
      const rect = sidebar && typeof sidebar.getBoundingClientRect === 'function' ? sidebar.getBoundingClientRect() : null;
      const collapsed = !rect || rect.width < 48;
      dockEl.setAttribute('data-collapsed', collapsed ? '1' : '0');
      const leftPx = rect && rect.width >= 48 ? Math.max(10, Math.round(rect.left + 10)) : 10;
      const maxBottom = Math.max(20, window.innerHeight - 94);
      const bottomPx = clamp(readBottomPx(), 12, maxBottom);
      dockEl.style.left = `${leftPx}px`;
      dockEl.style.bottom = `${bottomPx}px`;
      if (popoverEl && popoverEl.isConnected && popOpen) positionPopover();
    }

    function scheduleDockPosition() {
      if (posRaf) return;
      posRaf = requestAnimationFrame(applyDockPosition);
    }

    function positionPopover() {
      if (!popoverEl || !popoverEl.isConnected || !dockEl || !dockEl.isConnected) return;
      const dr = dockEl.getBoundingClientRect();
      const pr = popoverEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = pr.width || 256;
      const ph = pr.height || 180;
      const left = clamp(dr.right + 12, 12, Math.max(12, vw - pw - 12));
      const top = clamp(dr.bottom - ph, 12, Math.max(12, vh - ph - 12));
      popoverEl.style.left = `${Math.round(left)}px`;
      popoverEl.style.top = `${Math.round(top)}px`;
    }

    function updateSlider() {
      if (!popRefs || !popRefs.poolBar || popRefs.poolBar.hidden) return;
      const activeBtn = popRefs.poolBar.querySelector('.ag-qr-pool-tab.is-active');
      if (!activeBtn) {
        popRefs.poolSlider.style.opacity = '0';
        return;
      }
      popRefs.poolSlider.style.opacity = '1';
      popRefs.poolSlider.style.width = `${activeBtn.offsetWidth}px`;
      popRefs.poolSlider.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
    }

    function updateDockVisuals() {
      if (destroyed || !dockEl || !dockRing5h || !dockRingWeek) return;
      const quotaSnap = getQuotaSnapshot();
      const group = selectDisplayGroup(quotaSnap, pinnedPool);
      const { b5h, bWeek, pct5h, pctWeek, blockedByWeekly } = extractBuckets(group);

      dockEl.setAttribute('data-light', cachedLight ? '1' : '0');
      const col5h = ringColor(pct5h, '5h', blockedByWeekly, cachedLight);
      const colWeek = ringColor(pctWeek, 'weekly', false, cachedLight);

      dockRing5h.update(pct5h, col5h);
      dockRingWeek.update(pctWeek, colWeek);

      const tip = [
        pct5h !== null ? `5h 剩余 ${pct5h.toFixed(0)}% · ${formatReset(b5h)}` : '5h 额度: —',
        pctWeek !== null ? `周 剩余 ${pctWeek.toFixed(0)}% · ${formatReset(bWeek)}` : '周额度: —',
      ].join('\n');
      if (dockEl.title !== tip) dockEl.title = tip;
    }

    function buildPopoverDom() {
      const pop = document.createElement('div');
      pop.className = POPOVER_CLASS;
      pop.setAttribute('data-ag-no-i18n', '');
      pop.setAttribute('data-light', cachedLight ? '1' : '0');
      pop.setAttribute('data-visible', '0');

      const head = document.createElement('div');
      head.className = 'ag-qr-head';

      const title = document.createElement('span');
      title.className = 'ag-qr-title';
      title.textContent = 'Token 额度';

      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'ag-qr-refresh';
      refreshBtn.title = '刷新';
      refreshBtn.setAttribute('aria-label', '刷新');
      refreshBtn.innerHTML = REFRESH_ICON_SVG;
      refreshBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        refreshNow(true);
      });

      head.appendChild(title);
      head.appendChild(refreshBtn);

      const poolBar = document.createElement('div');
      poolBar.className = 'ag-qr-pool-bar';
      poolBar.hidden = true;

      const poolSlider = document.createElement('div');
      poolSlider.className = 'ag-qr-pool-slider';
      poolBar.appendChild(poolSlider);

      const meterList = document.createElement('div');
      meterList.className = 'ag-qr-meter-list';

      function makeMeterRow(labelText, ringSize, ringR, ringStroke) {
        const row = document.createElement('div');
        row.className = 'ag-qr-meter';

        const ringWrap = document.createElement('div');
        ringWrap.className = 'ag-qr-meter-ring';
        ringWrap.style.width = '32px';
        ringWrap.style.height = `${ringSize}px`;
        const ring = createRingDom(ringSize, ringR, ringStroke, false);
        ringWrap.appendChild(ring.svg);

        const body = document.createElement('div');
        body.className = 'ag-qr-meter-body';

        const top = document.createElement('div');
        top.className = 'ag-qr-meter-top';
        const nameEl = document.createElement('span');
        nameEl.className = 'ag-qr-meter-name';
        nameEl.textContent = labelText;
        const valEl = document.createElement('span');
        valEl.className = 'ag-qr-meter-val';
        valEl.textContent = '—';
        top.appendChild(nameEl);
        top.appendChild(valEl);

        const bar = document.createElement('div');
        bar.className = 'ag-qr-bar';
        const fill = document.createElement('span');
        fill.style.width = '0%';
        bar.appendChild(fill);

        const subEl = document.createElement('div');
        subEl.className = 'ag-qr-meter-sub';
        subEl.textContent = '—';

        body.appendChild(top);
        body.appendChild(bar);
        body.appendChild(subEl);

        row.appendChild(ringWrap);
        row.appendChild(body);
        meterList.appendChild(row);

        return { ring, valEl, fill, subEl };
      }

      const meter5h = makeMeterRow('5 小时额度', 32, 13.2, 2.6);
      const meterWeek = makeMeterRow('本周额度', 24, 9.5, 2.3);

      pop.appendChild(head);
      pop.appendChild(poolBar);
      pop.appendChild(meterList);

      pop.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      pop.addEventListener('click', (ev) => ev.stopPropagation());

      return { pop, refreshBtn, poolBar, poolSlider, meter5h, meterWeek, renderedPoolKey: '' };
    }

    function updatePopoverVisuals() {
      if (destroyed || !popoverEl || !popRefs || !popoverEl.isConnected) return;
      const quotaSnap = getQuotaSnapshot();
      const group = selectDisplayGroup(quotaSnap, pinnedPool);
      const { b5h, bWeek, pct5h, pctWeek, blockedByWeekly } = extractBuckets(group);
      const groups = Array.isArray(quotaSnap?.quotaData?.groups) ? quotaSnap.quotaData.groups : [];

      popoverEl.setAttribute('data-light', cachedLight ? '1' : '0');
      popRefs.refreshBtn.classList.toggle('is-spin', isRefreshing);

      const poolNames = groups.map((g) => g.groupName || g.name || '').filter(Boolean);
      const poolKey = poolNames.join('|');
      const activeName = group ? group.groupName || group.name || '' : '';

      if (poolNames.length > 1) {
        popRefs.poolBar.hidden = false;
        if (popRefs.renderedPoolKey !== poolKey) {
          popRefs.renderedPoolKey = poolKey;
          popRefs.poolBar.querySelectorAll('.ag-qr-pool-tab').forEach((n) => n.remove());
          for (const name of poolNames) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ag-qr-pool-tab';
            btn.textContent = name;
            btn.title = name;
            btn.setAttribute('data-pool', name);
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              pinnedPool = name;
              try {
                localStorage.setItem(STORAGE_PINNED_POOL_KEY, pinnedPool);
              } catch {}
              updateDockVisuals();
              updatePopoverVisuals();
            });
            popRefs.poolBar.appendChild(btn);
          }
        }
        popRefs.poolBar.querySelectorAll('.ag-qr-pool-tab').forEach((btn) => {
          btn.classList.toggle('is-active', btn.getAttribute('data-pool') === activeName);
        });
        requestAnimationFrame(updateSlider);
      } else {
        popRefs.poolBar.hidden = true;
      }

      const col5h = ringColor(pct5h, '5h', blockedByWeekly, cachedLight);
      const colWeek = ringColor(pctWeek, 'weekly', false, cachedLight);

      popRefs.meter5h.ring.update(pct5h, col5h);
      popRefs.meter5h.valEl.textContent = pct5h !== null ? `剩余 ${pct5h.toFixed(0)}%` : '—';
      popRefs.meter5h.valEl.style.color = pct5h !== null ? col5h : 'var(--qr-muted)';
      popRefs.meter5h.fill.style.width = `${pct5h !== null ? pct5h.toFixed(1) : 0}%`;
      popRefs.meter5h.fill.style.backgroundColor = col5h;
      popRefs.meter5h.subEl.textContent = blockedByWeekly
        ? '周额度已耗尽'
        : pct5h !== null
        ? formatReset(b5h)
        : '无独立 5h 额度';

      popRefs.meterWeek.ring.update(pctWeek, colWeek);
      popRefs.meterWeek.valEl.textContent = pctWeek !== null ? `剩余 ${pctWeek.toFixed(0)}%` : '—';
      popRefs.meterWeek.valEl.style.color = pctWeek !== null ? colWeek : 'var(--qr-muted)';
      popRefs.meterWeek.fill.style.width = `${pctWeek !== null ? pctWeek.toFixed(1) : 0}%`;
      popRefs.meterWeek.fill.style.backgroundColor = colWeek;
      popRefs.meterWeek.subEl.textContent = pctWeek !== null ? formatReset(bWeek) : '—';
    }

    function closePopover(immediate) {
      popOpen = false;
      if (dockEl) dockEl.setAttribute('data-open', '0');
      if (!popoverEl) return;
      if (popCloseTimer) {
        clearTimeout(popCloseTimer);
        popCloseTimer = null;
      }
      if (immediate) {
        popoverEl.remove();
        popoverEl = null;
        popRefs = null;
        return;
      }
      popoverEl.setAttribute('data-visible', '0');
      const target = popoverEl;
      popCloseTimer = setTimeout(() => {
        popCloseTimer = null;
        if (!popOpen && target === popoverEl) {
          target.remove();
          popoverEl = null;
          popRefs = null;
        }
      }, 170);
    }

    function openPopover() {
      if (destroyed || !dockEl) return;
      if (popOpen) {
        closePopover(false);
        return;
      }
      if (popCloseTimer) {
        clearTimeout(popCloseTimer);
        popCloseTimer = null;
      }
      if (!popoverEl || !popoverEl.isConnected) {
        popRefs = buildPopoverDom();
        popoverEl = popRefs.pop;
        document.body.appendChild(popoverEl);
      }
      popOpen = true;
      dockEl.setAttribute('data-open', '1');
      updatePopoverVisuals();
      positionPopover();
      requestAnimationFrame(() => {
        if (popoverEl && popOpen) {
          popoverEl.setAttribute('data-visible', '1');
          updateSlider();
        }
      });
      refreshNow(false);
    }

    function scheduleThemeCheck() {
      if (themeRaf) return;
      themeRaf = requestAnimationFrame(() => {
        themeRaf = 0;
        if (destroyed) return;
        const nextLight = detectLightTheme();
        if (nextLight !== cachedLight) {
          cachedLight = nextLight;
          updateDockVisuals();
          if (popOpen) updatePopoverVisuals();
        }
      });
    }

    async function refreshNow(force) {
      if (destroyed) return;
      isRefreshing = true;
      if (popOpen && popRefs) popRefs.refreshBtn.classList.add('is-spin');
      try {
        await refreshQuota(Boolean(force));
      } catch {} finally {
        isRefreshing = false;
      }
      if (!destroyed) {
        updateDockVisuals();
        if (popOpen) updatePopoverVisuals();
      }
    }

    function attachDrag(el) {
      let dragging = false;
      let moved = false;
      let startY = 0;
      let startBottom = 58;

      const onMove = (ev) => {
        if (!dragging) return;
        const dy = startY - ev.clientY;
        if (Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        const maxBottom = Math.max(20, window.innerHeight - 94);
        const nextBottom = clamp(startBottom + dy, 12, maxBottom);
        el.style.bottom = `${Math.round(nextBottom)}px`;
        saveBottomPx(nextBottom);
        if (popOpen) positionPopover();
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          el.setAttribute('data-just-dragged', '1');
          setTimeout(() => el && el.removeAttribute('data-just-dragged'), 180);
        }
      };

      el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        const onGrip = Boolean(ev.target?.closest?.('.ag-qr-grip'));
        if (!onGrip && !ev.altKey) return;
        dragging = true;
        moved = false;
        startY = ev.clientY;
        startBottom = readBottomPx();
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        ev.preventDefault();
      });
    }

    const onDocPointerDown = (ev) => {
      if (!popOpen) return;
      if (popoverEl && popoverEl.contains(ev.target)) return;
      if (dockEl && dockEl.contains(ev.target)) return;
      closePopover(false);
    };

    const onKeyDown = (ev) => {
      if (ev.key === 'Escape' && popOpen) closePopover(false);
    };

    const onResize = () => scheduleDockPosition();
    const onColorSchemeChange = () => scheduleThemeCheck();

    function mount() {
      if (destroyed || !document.body) return;
      injectStyles();
      document.querySelectorAll(`.${DOCK_CLASS}, .${POPOVER_CLASS}`).forEach((n) => n.remove());

      dockEl = document.createElement('div');
      dockEl.className = DOCK_CLASS;
      dockEl.setAttribute('role', 'button');
      dockEl.setAttribute('tabindex', '0');
      dockEl.setAttribute('aria-label', '查看 5 小时与每周 Token 额度');
      dockEl.setAttribute('data-ag-no-i18n', '');
      dockEl.setAttribute('data-open', '0');

      const grip = document.createElement('div');
      grip.className = 'ag-qr-grip';
      grip.title = '上下拖动调整位置';

      const box5h = document.createElement('div');
      box5h.className = 'ag-qr-ring-box is-5h';
      dockRing5h = createRingDom(32, 13.2, 2.6, true);
      box5h.appendChild(dockRing5h.svg);
      box5h.appendChild(dockRing5h.numEl);

      const boxWeek = document.createElement('div');
      boxWeek.className = 'ag-qr-ring-box is-week';
      dockRingWeek = createRingDom(22, 8.7, 2.2, true);
      boxWeek.appendChild(dockRingWeek.svg);
      boxWeek.appendChild(dockRingWeek.numEl);

      dockEl.appendChild(grip);
      dockEl.appendChild(box5h);
      dockEl.appendChild(boxWeek);

      attachDrag(dockEl);

      dockEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (dockEl.getAttribute('data-just-dragged') === '1') return;
        openPopover();
      });
      dockEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openPopover();
        }
      });

      document.body.appendChild(dockEl);
      cachedLight = detectLightTheme();
      updateDockVisuals();
      applyDockPosition();

      document.addEventListener('pointerdown', onDocPointerDown, false);
      document.addEventListener('keydown', onKeyDown, false);
      window.addEventListener('resize', onResize, { passive: true });

      if (typeof ResizeObserver === 'function') {
        resizeObs = new ResizeObserver(scheduleDockPosition);
        const split = document.querySelector('[data-testid="sidebar-split"]');
        if (split) resizeObs.observe(split);
        if (split?.firstElementChild) resizeObs.observe(split.firstElementChild);
      }

      if (typeof MutationObserver === 'function') {
        themeObs = new MutationObserver(scheduleThemeCheck);
        themeObs.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-ag-cs-palette'],
        });
        if (document.body) {
          themeObs.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'data-agy-theme'],
          });
        }
      }

      try {
        if (window.matchMedia) {
          mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
          if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', onColorSchemeChange);
          }
        }
      } catch {}

      refreshNow(false);
      retryTimer = setTimeout(() => {
        if (!destroyed) {
          scheduleDockPosition();
          refreshNow(false);
        }
      }, 2800);

      pollTimer = setInterval(() => {
        if (destroyed) return;
        updateDockVisuals();
        refreshNow(false);
      }, POLL_MS);
    }

    function destroy() {
      destroyed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (popCloseTimer) clearTimeout(popCloseTimer);
      if (posRaf) cancelAnimationFrame(posRaf);
      if (themeRaf) cancelAnimationFrame(themeRaf);
      if (resizeObs) {
        try { resizeObs.disconnect(); } catch {}
        resizeObs = null;
      }
      if (themeObs) {
        try { themeObs.disconnect(); } catch {}
        themeObs = null;
      }
      if (mediaQuery && typeof mediaQuery.removeEventListener === 'function') {
        try { mediaQuery.removeEventListener('change', onColorSchemeChange); } catch {}
        mediaQuery = null;
      }
      document.removeEventListener('pointerdown', onDocPointerDown, false);
      document.removeEventListener('keydown', onKeyDown, false);
      window.removeEventListener('resize', onResize);
      closePopover(true);
      if (dockEl) {
        dockEl.remove();
        dockEl = null;
      }
      const st = document.getElementById(STYLE_ID);
      if (st) st.remove();
      const gf = document.getElementById(GFONT_LINK_ID);
      if (gf) gf.remove();
    }

    if (document.body) {
      mount();
    } else {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    }

    return {
      version: '1.0.0',
      refresh: () => refreshNow(true),
      destroy,
    };
  }

  root.__agQuotaRings = createInstance();
})(typeof globalThis !== 'undefined' ? globalThis : window);
