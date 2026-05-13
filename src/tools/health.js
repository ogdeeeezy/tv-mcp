import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/health.js';
import * as diag from '../core/diagnostics.js';

export function registerHealthTools(server) {
  server.tool('tv_health_check', 'Check CDP connection to TradingView and return current chart state', {}, async () => {
    try { return jsonResult(await core.healthCheck()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'TradingView is not running with CDP enabled. Use the tv_launch tool to start it automatically.' }, true); }
  });

  server.tool('tv_discover', 'Report which known TradingView API paths are available and their methods', {}, async () => {
    try { return jsonResult(await core.discover()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_ui_state', 'Get current UI state: which panels are open, what buttons are visible/enabled/disabled', {}, async () => {
    try { return jsonResult(await core.uiState()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_launch', 'DEPRECATED — use chrome_launch. This stub forwards to chrome_launch so existing callers keep working. TradingView Desktop (Electron) targeting was replaced by Chrome CDP after the multi-tab audit.', {
    port: z.coerce.number().optional().describe('CDP port (default 9222)'),
    kill_existing: z.coerce.boolean().optional().describe('Kill existing Chrome first (default false in chrome_launch)'),
  }, async ({ port, kill_existing }) => {
    try {
      const result = await diag.chromeLaunch({ port, kill_existing });
      return jsonResult({ ...result, deprecation_notice: 'tv_launch is deprecated; call chrome_launch directly. This wrapper will be removed in a future release.' });
    }
    catch (err) { return jsonResult({ success: false, error: err.message, deprecation_notice: 'tv_launch is deprecated; call chrome_launch directly.' }, true); }
  });
}
