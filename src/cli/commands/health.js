import { register } from '../router.js';
import * as core from '../../core/health.js';
import * as diag from '../../core/diagnostics.js';

register('status', {
  description: 'Check CDP connection to Chrome (TradingView open)',
  handler: () => core.healthCheck(),
});

register('launch', {
  description: 'Launch Chrome with CDP enabled (requires --user-data-dir on Chrome 136+)',
  options: {
    port: { type: 'string', short: 'p', description: 'CDP port (default 9222)' },
    'user-data-dir': { type: 'string', short: 'd', description: 'Chrome profile dir (REQUIRED on Chrome 136+ for default-profile launches; the security restriction refuses to bind the debug port without it)' },
    'kill-existing': { type: 'boolean', description: 'Kill running Chrome processes first' },
  },
  handler: (opts) => diag.chromeLaunch({
    port: opts.port ? Number(opts.port) : undefined,
    user_data_dir: opts['user-data-dir'],
    kill_existing: opts['kill-existing'],
  }),
});
