import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/pine.js';

export function registerPineTools(server) {
  server.tool('pine_get_source', 'Get current Pine Script source code from the editor', {}, async () => {
    try { return jsonResult(await core.getSource()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_set_source', 'Set Pine Script source code in the editor', {
    source: z.string().describe('Pine Script source code to inject'),
  }, async ({ source }) => {
    try { return jsonResult(await core.setSource({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_compile', 'Compile / add the current Pine Script to the chart', {}, async () => {
    try { return jsonResult(await core.compile()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_get_errors', 'Get Pine Script compilation errors from Monaco markers', {}, async () => {
    try { return jsonResult(await core.getErrors()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'pine_save',
    'Persist the current editor source to a TradingView cloud script slot, with end-to-end verification via pine-facade. Three paths based on args + editor state: (a) `scriptIdPart` provided — overwrites that specific slot in place via POST /pine-facade/save/next/<id> (captured 2026-06-10). This is the in-place edit path after pine_open. Wins over editor binding. (b) editor is bound to an existing script (title button shows the script name) AND no scriptIdPart — invokes Monaco save.script + polls pine-facade /get/{id}/last until the persisted source matches. (c) editor is unbound ("Untitled script") AND no scriptIdPart — requires `name` and POSTs to /pine-facade/save/new (allow_overwrite=false) to create a new slot. Replaces the pre-2026-06-07 Ctrl+S dispatch that silently no-op\'d on wrong focus (incident 2026-06-05).',
    {
      name: z.string().optional().describe('Create-new path: required when the editor is an unbound draft and no scriptIdPart is given. Refuses with allow_overwrite=false if a script with this name already exists. Ignored when scriptIdPart is given or the editor is bound.'),
      scriptIdPart: z.string().optional().describe('In-place overwrite path: e.g. "USER;2305e8248b1e4de28f93a4a9cea275e9" (use the value returned by pine_open or pine_list_scripts). Posts current editor source to that exact slot. Refuses if id is unknown.'),
      verify_timeout_ms: z.number().optional().describe('Max time to poll pine-facade for the persisted source to match the editor source. Default 5000.'),
    },
    async ({ name, scriptIdPart, verify_timeout_ms }) => {
      try { return jsonResult(await core.save({ name: name || null, scriptIdPart: scriptIdPart || null, verify_timeout_ms: verify_timeout_ms || 5000 })); }
      catch (err) { return jsonResult({ success: false, error: err.message, code: err.code || null }, true); }
    }
  );

  server.tool('pine_get_console', 'Read Pine Script console/log output (compile messages, log.info(), errors)', {}, async () => {
    try { return jsonResult(await core.getConsole()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_smart_compile', 'Intelligent compile: detects button, compiles, checks errors, reports study changes', {}, async () => {
    try { return jsonResult(await core.smartCompile()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'pine_new',
    'Create a new Pine Script. Invokes TV\'s Monaco new_indicator/new_strategy action to swap the editor to a fresh UNBOUND model — this is the critical safety primitive that decouples the editor from any previously-loaded cloud script (prevents the 2026-06-05 silent-overwrite bug). If `name` is provided, also POSTs to /pine-facade/save/new (allow_overwrite=false) to create a real cloud slot immediately; returns the new scriptIdPart. If `name` is omitted, leaves the editor as an unbound draft that cannot accidentally overwrite an existing script; caller must use pine_save({name}) to persist.',
    {
      type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create. Library uses the new_indicator action to unbind then replaces source (TV does not register a new_library Monaco action).'),
      name: z.string().optional().describe('Optional: cloud script slot name. When provided, the script is immediately persisted to TradingView via pine-facade. Refuses with allow_overwrite=false if a script with this name already exists.'),
      source: z.string().optional().describe('Optional: starting source code. Defaults to a minimal v6 template for the chosen type.'),
    },
    async ({ type, name, source }) => {
      try { return jsonResult(await core.newScript({ type, name: name || null, source: source || null })); }
      catch (err) { return jsonResult({ success: false, error: err.message, code: err.code || null }, true); }
    }
  );

  server.tool(
    'pine_open',
    'Load a saved Pine Script\'s source into the editor as an UNBOUND draft. Runs the new_indicator Monaco action first to clear any prior binding (prevents the 2026-06-05 silent-overwrite incident shape), then fetches and setValues the script source. The editor will show "Untitled script". Returns the script\'s `script_id` (scriptIdPart) — pass that to pine_save({scriptIdPart}) to overwrite the slot in place after editing. Calling pine_save({name: "<same name>"}) instead would 409 (save/new refuses duplicate names).',
    {
      name: z.string().describe('Name of the saved script to open (case-insensitive match)'),
    },
    async ({ name }) => {
    try { return jsonResult(await core.openScript({ name })); }
    catch (err) { return jsonResult({ success: false, source: 'internal_api', error: err.message }, true); }
  });

  server.tool('pine_list_scripts', 'List saved Pine Scripts', {}, async () => {
    try { return jsonResult(await core.listScripts()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'pine_delete',
    'Delete a saved Pine Script slot from your TradingView cloud library. Targets by `scriptIdPart` (exact) or `name` (case-insensitive; refuses on ambiguous match). Requires pine_claim. Endpoint POST https://pine-facade.tradingview.com/pine-facade/delete/<urlencoded-id> (captured 2026-06-10 from TV web UI delete action). Verifies by re-listing and confirming absence.',
    {
      name: z.string().optional().describe('Saved script name (case-insensitive). Refuses if 0 or >1 matches.'),
      scriptIdPart: z.string().optional().describe('Exact scriptIdPart (e.g. "USER;4b19bc6cc1814d0f99cef1e421c13346") from pine_list_scripts. Wins over `name` if both provided.'),
    },
    async ({ name, scriptIdPart }) => {
      try { return jsonResult(await core.deleteScript({ name: name || null, scriptIdPart: scriptIdPart || null })); }
      catch (err) { return jsonResult({ success: false, error: err.message, code: err.code || null, matches: err.matches || null }, true); }
    }
  );

  server.tool('pine_analyze', 'Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded array.first()/last(), bad loop bounds, and implicit bool casts. Works offline, no TradingView connection needed.', {
    source: z.string().describe('Pine Script source code to analyze'),
  }, async ({ source }) => {
    try { return jsonResult(core.analyze({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_check', 'Compile Pine Script via TradingView\'s server API without needing the chart open. Returns compilation errors/warnings. Useful for validating code before injecting into the chart.', {
    source: z.string().describe('Pine Script source code to compile/validate'),
  }, async ({ source }) => {
    try { return jsonResult(await core.check({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'pine_claim',
    'Claim the Pine editor for this MCP process. Pine write tools (pine_new, pine_set_source, pine_save, pine_smart_compile, pine_compile) require an active claim. The Pine editor is a singleton resource across the whole Chrome instance — without coordination, two Claude sessions can silently overwrite each other (incident 2026-06-05). Returns {conflict, owner} if another live PID already holds it.',
    {
      force: z.boolean().optional().describe('Override an existing live claim. Use only when the other session is known stuck.'),
      scriptIdPart: z.string().optional().describe('Optional: TV scriptIdPart of the script you intend to edit (informational only).'),
    },
    async ({ force, scriptIdPart }) => {
      try { return jsonResult(await core.pineClaim({ force: !!force, scriptIdPart })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'pine_release',
    'Release the Pine editor claim held by this MCP process. Idempotent — succeeds silently if not held.',
    {},
    async () => {
      try { return jsonResult(await core.pineRelease()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'pine_claim_status',
    'Read-only view of the current Pine editor claim. Returns {claimed, claim, mine}.',
    {},
    async () => {
      try { return jsonResult(await core.pineClaimStatus()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );
}
