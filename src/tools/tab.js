import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/tab.js';

export function registerTabTools(server) {
  server.tool('tab_list', 'List all open TradingView chart tabs', {}, async () => {
    try { return jsonResult(await core.list()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_new', 'Open a new chart tab', {}, async () => {
    try { return jsonResult(await core.newTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_close', 'Close the current chart tab (Electron path — may not decrement on Chrome; prefer tab_close_by_id)', {}, async () => {
    try { return jsonResult(await core.closeTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_switch', 'Switch to a chart tab by index', {
    index: z.coerce.number().describe('Tab index (0-based, from tab_list)'),
  }, async ({ index }) => {
    try { return jsonResult(await core.switchTab({ index })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_picker', 'Enriched list of TV tabs (id, title, symbol, chart_id, pinned-flag). Use this to choose what to pin.', {}, async () => {
    try { return jsonResult(await core.picker()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_pin', 'Pin the MCP to a specific tab so all subsequent calls target it. Pass exactly one of: id, title, symbol, url. Claims the tab in the cross-instance pin registry (~/.tv-mcp-registry.json) — if another live Claude session already owns this tab, the call returns {conflict: true, owner: {...}} unless force=true. Cleared on tab_unpin or process exit.', {
    id: z.string().optional().describe('Exact CDP target id (from tab_picker)'),
    title: z.string().optional().describe('Substring match on tab title (case-insensitive)'),
    symbol: z.string().optional().describe('Substring match on symbol (e.g. "GC1!", "ICC")'),
    url: z.string().optional().describe('Substring match on URL (e.g. "/chart/Wfn4")'),
    force: z.boolean().optional().describe('Override an existing cross-instance claim. Use only when you know the other process is stuck or you intend to take over.'),
  }, async (args) => {
    try { return jsonResult(await core.pin(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_unpin', 'Clear the tab pin and release the cross-instance registry claim. Reverts to default-tab selection.', {}, async () => {
    try { return jsonResult(await core.unpin()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_close_by_id', 'Close a tab by exact CDP target id via HTTP /json/close. Replacement for broken upstream tab_close on Chrome.', {
    id: z.string().describe('CDP target id (from tab_list or tab_picker)'),
  }, async ({ id }) => {
    try { return jsonResult(await core.closeById({ id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_registry', 'Read-only view of the cross-instance pin registry. Shows every tab currently claimed by any live tv-mcp process (across all Claude sessions). Use this BEFORE tab_pin to see whether another session already owns the tab you want.', {}, async () => {
    try { return jsonResult(await core.registryList()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
