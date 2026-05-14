import CDP from 'chrome-remote-interface';
import { claim as registryClaim, release as registryRelease, releaseAllSync } from './core/pin_registry.js';

let client = null;
let targetInfo = null;
let pinnedTargetId = null;
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

// Startup-time target filter. Parsed once from TV_MCP_TARGET_FILTER env var.
// Syntax: "<field><op><value>" where field ∈ {symbol, title, url, id}, op ∈ {=, ~}.
// Both = and ~ are case-insensitive substring matches except id= which is exact.
// Examples: symbol=COMEX:GC1!, title~ICC, url~chart/Wfn4, id=ABC123
const activeFilter = parseFilter(process.env.TV_MCP_TARGET_FILTER);

function parseFilter(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(symbol|title|url|id)\s*([=~])\s*(.+)$/i);
  if (!m) {
    throw new Error(`Invalid TV_MCP_TARGET_FILTER: ${raw}. Expected <field><op><value> where field is symbol|title|url|id and op is = or ~.`);
  }
  return { field: m[1].toLowerCase(), op: m[2], value: m[3].trim() };
}

function targetMatchesFilter(target, filter) {
  if (!filter) return true;
  const { field, op, value } = filter;
  if (field === 'id') return target.id === value;
  const haystack = field === 'title' ? (target.title || '')
    : field === 'url' ? (target.url || '')
    : /* symbol: URL substring is the reliable signal */ (target.url || '');
  return haystack.toLowerCase().includes(value.toLowerCase());
}

/**
 * Set the in-process pin. Does NOT touch the cross-instance registry — callers
 * that want registry coordination should use claimAndPin() instead. This stays
 * registry-free so internal reconnect flows (e.g., transient CDP drops) can
 * rebind without re-claiming.
 */
export function setPin(targetId) {
  pinnedTargetId = targetId;
  // Force reconnect on next getClient call so the new pin takes effect immediately.
  if (client) {
    try { client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

export function clearPin() { setPin(null); }
export function getPin() { return pinnedTargetId; }
export function getActiveFilter() { return activeFilter; }

/**
 * Claim a target in the cross-instance registry, then pin it in-process.
 * Throws with code=PIN_CONFLICT if another live process owns it (unless force).
 */
export async function claimAndPin(targetId, { force = false, lane = null } = {}) {
  const prev = pinnedTargetId;
  const result = await registryClaim(targetId, { force, lane });
  setPin(targetId);
  // Release any previous pin we held — we're moving to a new tab.
  if (prev && prev !== targetId) {
    try { await registryRelease(prev); } catch {}
  }
  return result;
}

/**
 * Release the cross-instance claim AND clear the in-process pin.
 */
export async function releaseAndUnpin() {
  const prev = pinnedTargetId;
  setPin(null);
  if (prev) {
    return registryRelease(prev);
  }
  return { released: false };
}

// Best-effort cleanup on process exit so we don't leave stale claims behind.
// Idempotent — releaseAllSync swallows its own errors.
let _exitHandlerRegistered = false;
function ensureExitHandler() {
  if (_exitHandlerRegistered) return;
  _exitHandlerRegistered = true;
  const cleanup = () => releaseAllSync();
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}
ensureExitHandler();

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

export async function getClient() {
  if (client) {
    try {
      // Quick liveness check
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findChartTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const pages = targets.filter(t => t.type === 'page');

  // 1. Runtime pin wins: must match exactly or we hard-fail (deterministic by design).
  if (pinnedTargetId) {
    const pinned = pages.find(t => t.id === pinnedTargetId);
    if (!pinned) {
      throw new Error(`Pinned target ${pinnedTargetId} not found. Tab may have been closed. Call tab_unpin or tab_pin <new-id>.`);
    }
    return pinned;
  }

  // 2. Startup filter: scope candidate set to filter-matching TV pages.
  const tvPages = pages.filter(t => /tradingview\.com\/chart/i.test(t.url) || /tradingview/i.test(t.url));
  const candidates = activeFilter ? tvPages.filter(t => targetMatchesFilter(t, activeFilter)) : tvPages;

  if (activeFilter && candidates.length === 0) {
    throw new Error(`No TradingView tab matches filter ${activeFilter.field}${activeFilter.op}${activeFilter.value}. Open the tab or change TV_MCP_TARGET_FILTER.`);
  }

  // 3. Default: prefer /chart pages over generic TradingView pages.
  return candidates.find(t => /tradingview\.com\/chart/i.test(t.url))
    || candidates.find(t => /tradingview/i.test(t.url))
    || null;
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
