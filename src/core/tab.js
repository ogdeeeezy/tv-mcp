/**
 * Core tab management logic.
 * Controls TradingView Desktop tabs via CDP and Electron keyboard shortcuts.
 */
import { getClient, evaluate, setPin, clearPin, getPin } from '../connection.js';

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

/**
 * List all open chart tabs (CDP page targets).
 */
export async function list() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();

  const tabs = targets
    .filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    .map((t, i) => ({
      index: i,
      id: t.id,
      title: t.title.replace(/^Live stock.*charts on /, ''),
      url: t.url,
      chart_id: t.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
    }));

  return { success: true, tab_count: tabs.length, tabs };
}

/**
 * Open a new chart tab via keyboard shortcut (Ctrl+T / Cmd+T).
 */
export async function newTab() {
  const c = await getClient();

  // Electron/TradingView Desktop uses Ctrl+T for new tab on macOS too
  // But some versions use Cmd+T
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2; // 4 = meta (Cmd), 2 = ctrl

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 't',
    code: 'KeyT',
    windowsVirtualKeyCode: 84,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 't', code: 'KeyT' });

  await new Promise(r => setTimeout(r, 2000));

  // Verify a new tab appeared
  const state = await list();
  return { success: true, action: 'new_tab_opened', ...state };
}

/**
 * Close the current tab via keyboard shortcut (Ctrl+W / Cmd+W).
 */
export async function closeTab() {
  const before = await list();
  if (before.tab_count <= 1) {
    throw new Error('Cannot close the last tab. Use tv_launch to restart TradingView instead.');
  }

  const c = await getClient();
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2;

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'w', code: 'KeyW' });

  await new Promise(r => setTimeout(r, 1000));

  const after = await list();
  return { success: true, action: 'tab_closed', tabs_before: before.tab_count, tabs_after: after.tab_count };
}

/**
 * Enriched list of TV tabs for human/AI selection. Includes pin state.
 * Adds chart_id, symbol (parsed from title), pinned flag.
 */
export async function picker() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const pinId = getPin();

  const tvPages = targets.filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url));
  const tabs = tvPages.map((t, i) => {
    // TV titles look like: "GOLD FUTURES (GC1!), 4h Chart Online — TradingView"
    // Symbol is the parenthetical before " Chart".
    const symbolMatch = t.title.match(/\(([^)]+)\)\s*,/);
    return {
      index: i,
      id: t.id,
      title: t.title.replace(/^Live stock.*charts on /, '').replace(/\s*[-—]\s*TradingView$/, ''),
      symbol: symbolMatch ? symbolMatch[1] : null,
      url: t.url,
      chart_id: t.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
      pinned: t.id === pinId,
    };
  });

  return { success: true, tab_count: tabs.length, pinned_id: pinId, tabs };
}

/**
 * Pin the MCP to a specific tab. Accepts exact id, or substring match on
 * title/symbol/url (case-insensitive). Exactly one of {id, title, symbol, url}
 * must be provided. Returns the resolved tab and confirms the pin.
 */
export async function pin({ id, title, symbol, url } = {}) {
  const provided = [id, title, symbol, url].filter(v => v !== undefined && v !== null && v !== '').length;
  if (provided !== 1) {
    throw new Error('tab_pin requires exactly one of: id, title, symbol, url');
  }

  const all = await picker();
  let match;
  if (id) {
    match = all.tabs.find(t => t.id === id);
    if (!match) throw new Error(`No tab with id=${id}. Use tab_picker to list tabs.`);
  } else if (title) {
    const needle = title.toLowerCase();
    match = all.tabs.find(t => (t.title || '').toLowerCase().includes(needle));
    if (!match) throw new Error(`No tab title matches "${title}"`);
  } else if (symbol) {
    const needle = symbol.toLowerCase();
    match = all.tabs.find(t => (t.symbol || '').toLowerCase().includes(needle));
    if (!match) throw new Error(`No tab symbol matches "${symbol}"`);
  } else if (url) {
    const needle = url.toLowerCase();
    match = all.tabs.find(t => (t.url || '').toLowerCase().includes(needle));
    if (!match) throw new Error(`No tab url matches "${url}"`);
  }

  setPin(match.id);
  return { success: true, action: 'pinned', pinned_to: match };
}

export async function unpin() {
  const prev = getPin();
  clearPin();
  return { success: true, action: 'unpinned', previous_pin: prev };
}

/**
 * Close a tab by exact CDP target id via HTTP /json/close. Replacement for
 * the broken upstream tab_close (Electron-keyboard path that doesn't work on Chrome).
 */
export async function closeById({ id }) {
  if (!id) throw new Error('tab_close_by_id requires id');

  const before = await list();
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${encodeURIComponent(id)}`);
  const text = await resp.text();

  // /json/close returns "Target is closing" on success.
  const ok = resp.ok && /closing/i.test(text);
  if (!ok) throw new Error(`CDP /json/close returned ${resp.status}: ${text}`);

  // If we just closed the pinned tab, clear the pin.
  if (getPin() === id) clearPin();

  await new Promise(r => setTimeout(r, 500));
  const after = await list();
  return {
    success: true,
    action: 'closed',
    target_id: id,
    tabs_before: before.tab_count,
    tabs_after: after.tab_count,
    pin_cleared: getPin() === null && before.tab_count !== after.tab_count,
  };
}

/**
 * Switch to a tab by index. Reconnects CDP to the new target.
 */
export async function switchTab({ index }) {
  const tabs = await list();
  const idx = Number(index);

  if (idx >= tabs.tab_count) {
    throw new Error(`Tab index ${idx} out of range (have ${tabs.tab_count} tabs)`);
  }

  const target = tabs.tabs[idx];

  // Use CDP Target.activateTarget to bring the tab to front
  try {
    const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${target.id}`);
    const text = await resp.text();
    return { success: true, action: 'switched', index: idx, tab_id: target.id, chart_id: target.chart_id };
  } catch (e) {
    throw new Error(`Failed to activate tab ${idx}: ${e.message}`);
  }
}
