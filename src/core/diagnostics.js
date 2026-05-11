/**
 * Diagnostics: chrome_launch, chrome_health, tv_reset.
 * chrome_launch replaces upstream tv_launch — we drive Chrome, not TV Desktop.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { getActiveFilter, getPin, setPin, evaluate, disconnect } from '../connection.js';
import * as tab from './tab.js';
import { log } from './mcp_log.js';

const CDP_HOST = 'localhost';
const DEFAULT_PORT = 9222;

const CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['google-chrome', 'chromium', 'chromium-browser'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

function findChromeBinary() {
  const candidates = CHROME_PATHS[process.platform] || [];
  for (const p of candidates) {
    if (p.includes('/') || p.includes('\\')) {
      if (fs.existsSync(p)) return p;
    } else {
      return p; // assume on PATH
    }
  }
  return null;
}

/**
 * Probe the CDP endpoint. Returns version + tab counts.
 */
export async function chromeHealth({ port = DEFAULT_PORT } = {}) {
  const start = Date.now();
  try {
    const versionResp = await fetch(`http://${CDP_HOST}:${port}/json/version`);
    if (!versionResp.ok) throw new Error(`HTTP ${versionResp.status}`);
    const version = await versionResp.json();

    const listResp = await fetch(`http://${CDP_HOST}:${port}/json/list`);
    const targets = await listResp.json();
    const pages = targets.filter(t => t.type === 'page');
    const tvTabs = pages.filter(t => /tradingview/i.test(t.url));

    return {
      success: true,
      debug_port: port,
      alive: true,
      latency_ms: Date.now() - start,
      browser: version.Browser,
      protocol_version: version['Protocol-Version'],
      user_agent: version['User-Agent'],
      tabs: { total: pages.length, tradingview: tvTabs.length, other: pages.length - tvTabs.length },
      mcp_state: { pinned_target: getPin(), startup_filter: getActiveFilter() },
    };
  } catch (err) {
    return {
      success: false,
      debug_port: port,
      alive: false,
      latency_ms: Date.now() - start,
      error: err.message,
      hint: 'Chrome may not be running with --remote-debugging-port=9222. Use chrome_launch to start it.',
    };
  }
}

/**
 * Launch Chrome with CDP enabled. Idempotent — returns early if already alive.
 */
export async function chromeLaunch({ port = DEFAULT_PORT, kill_existing = false, user_data_dir } = {}) {
  // Idempotent check unless caller wants a forced relaunch.
  if (!kill_existing) {
    const h = await chromeHealth({ port });
    if (h.alive) {
      return { success: true, action: 'already_running', ...h };
    }
  }

  const bin = findChromeBinary();
  if (!bin) {
    return {
      success: false,
      error: `Chrome binary not found for platform ${process.platform}`,
      checked: CHROME_PATHS[process.platform] || [],
    };
  }

  if (kill_existing && process.platform === 'darwin') {
    try {
      const { execSync } = await import('node:child_process');
      execSync('pkill -x "Google Chrome" || true');
      await new Promise(r => setTimeout(r, 1500));
    } catch {}
  }

  const args = [`--remote-debugging-port=${port}`];
  if (user_data_dir) args.push(`--user-data-dir=${user_data_dir}`);

  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  log('info', 'chrome_launch spawned', { pid: child.pid, port, bin });

  // Wait up to 5 s for the debug port to come up.
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    const h = await chromeHealth({ port });
    if (h.alive) {
      return { success: true, action: 'launched', pid: child.pid, ...h };
    }
  }

  return { success: false, action: 'launched_but_not_responsive', pid: child.pid, port, hint: 'Chrome started but CDP did not come up within 5s. Check that port is not blocked.' };
}

/**
 * Programmatic version of the tv-reset skill. Diagnose desync, attempt recovery, verdict.
 * Does NOT touch chart state — only the MCP↔CDP connection layer.
 */
export async function tvReset() {
  const steps = [];

  // 1. Chrome alive?
  const health = await chromeHealth();
  steps.push({ step: 'chrome_health', ok: health.alive, detail: health.alive ? `${health.tabs.tradingview} TV tabs of ${health.tabs.total} total` : health.error });
  if (!health.alive) {
    return { success: false, verdict: 'chrome_down', steps, recommendation: 'Run chrome_launch to start Chrome with CDP enabled.' };
  }

  if (health.tabs.tradingview === 0) {
    return { success: false, verdict: 'no_tv_tab', steps, recommendation: 'Open https://www.tradingview.com/chart/ in Chrome.' };
  }

  // 2. Drop stale CDP client.
  try { await disconnect(); steps.push({ step: 'disconnect_stale_client', ok: true }); }
  catch (err) { steps.push({ step: 'disconnect_stale_client', ok: false, error: err.message }); }

  // 3. Pinned target still exists?
  if (getPin()) {
    const target = health.tabs.tradingview > 0;
    const tabs = await tab.list();
    const pinned = tabs.tabs.find(t => t.id === getPin());
    if (!pinned) {
      setPin(null);
      steps.push({ step: 'pin_check', ok: false, action: 'pin_cleared', detail: `Pinned target ${getPin()} was gone — pin cleared.` });
    } else {
      steps.push({ step: 'pin_check', ok: true, detail: `Pin still valid: ${pinned.title}` });
    }
  }

  // 4. Reconnect and probe TV API.
  try {
    const probe = await evaluate('typeof window.TradingViewApi !== "undefined" && typeof window.TradingViewApi._activeChartWidgetWV !== "undefined"');
    steps.push({ step: 'tv_api_probe', ok: !!probe, detail: probe ? 'TradingViewApi present' : 'TradingViewApi missing — page may not be a chart page' });
    if (!probe) {
      return { success: false, verdict: 'tv_api_missing', steps, recommendation: 'Navigate the active tab to https://www.tradingview.com/chart/ and retry.' };
    }
  } catch (err) {
    steps.push({ step: 'tv_api_probe', ok: false, error: err.message });
    return { success: false, verdict: 'evaluate_failed', steps, recommendation: 'CDP connection broken. Try chrome_launch with kill_existing=true.' };
  }

  return { success: true, verdict: 'healthy', steps };
}
