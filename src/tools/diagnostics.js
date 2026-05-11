import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as diag from '../core/diagnostics.js';
import * as mcpLog from '../core/mcp_log.js';

export function registerDiagnosticTools(server) {
  server.tool('chrome_launch', 'Launch Chrome with --remote-debugging-port enabled. Idempotent — returns early if CDP is already alive. Replaces upstream tv_launch (which targeted TradingView Desktop / Electron).', {
    port: z.coerce.number().optional().describe('CDP port (default 9222)'),
    kill_existing: z.coerce.boolean().optional().describe('Kill existing Chrome first (default false). Use when CDP is wedged.'),
    user_data_dir: z.string().optional().describe('Custom Chrome profile dir (advanced — for parallel isolated sessions)'),
  }, async (args) => {
    try { return jsonResult(await diag.chromeLaunch(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chrome_health', 'Probe Chrome CDP: version, total tabs, TV tab count, MCP pin/filter state. The "is the platform alive?" check.', {
    port: z.coerce.number().optional().describe('CDP port (default 9222)'),
  }, async (args) => {
    try { return jsonResult(await diag.chromeHealth(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_reset', 'Programmatic version of the tv-reset skill. Diagnoses CDP desync (stale client, dead pin, missing TV API) and attempts automated recovery. Returns step-by-step verdict.', {}, async () => {
    try { return jsonResult(await diag.tvReset()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('mcp_log_tail', 'Return last N lines of the MCP server log. Requires TV_MCP_LOG=1 or TV_MCP_LOG_FILE=<path> set when the MCP was started.', {
    lines: z.coerce.number().optional().describe('How many lines to return (default 50)'),
  }, async ({ lines }) => {
    try { return jsonResult(await mcpLog.tail({ lines })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
