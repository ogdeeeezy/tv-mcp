/**
 * tv setup — one-shot onboarding command.
 *
 * Picks an isolated Chrome profile path for the current OS, creates it if missing,
 * launches Chrome with CDP enabled against that profile, and prints the .mcp.json
 * snippet the user needs to paste into Claude Code's config.
 *
 * The friend-onboarding path: clone repo → npm install → npm run setup → paste config → done.
 */
import { register } from '../router.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as diag from '../../core/diagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'src', 'server.js');

function defaultProfilePath() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'tv-mcp-chrome');
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'tv-mcp-chrome');
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'tv-mcp-chrome');
  }
}

function buildMcpConfig(lanes) {
  const servers = {};
  for (const lane of lanes) {
    servers[lane] = {
      command: 'node',
      args: [SERVER_ENTRY],
    };
  }
  return { mcpServers: servers };
}

async function setup({ userDataDir, lanes, port = 9222 } = {}) {
  const profilePath = userDataDir || defaultProfilePath();
  const steps = [];

  // 1. Ensure profile dir exists.
  let created = false;
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(profilePath, { recursive: true });
    created = true;
  }
  steps.push({
    step: 'profile_dir',
    path: profilePath,
    action: created ? 'created' : 'already_exists',
  });

  // 2. Launch Chrome (idempotent).
  const launch = await diag.chromeLaunch({ port, user_data_dir: profilePath });
  steps.push({
    step: 'chrome_launch',
    action: launch.action,
    success: launch.success,
    debug_port: port,
    ...(launch.error ? { error: launch.error } : {}),
    ...(launch.hint ? { hint: launch.hint } : {}),
  });

  // 3. Build the MCP config snippet for the requested lane count.
  const config = buildMcpConfig(lanes);

  return {
    success: launch.success,
    profile_dir: profilePath,
    debug_port: port,
    server_entry: SERVER_ENTRY,
    mcp_config: config,
    next_steps: [
      'In the Chrome window that just opened, navigate to https://www.tradingview.com/chart/ and log in.',
      'Copy the "mcp_config" block above into ~/.claude/.mcp.json (merge with any existing mcpServers).',
      'Restart Claude Code so it picks up the new MCP servers.',
      'Ask Claude: "Use tv_health_check to verify TradingView is connected."',
    ],
    steps,
  };
}

register('setup', {
  description: 'One-shot onboarding: create Chrome profile, launch Chrome with CDP, print .mcp.json snippet.',
  options: {
    'user-data-dir': {
      type: 'string',
      short: 'd',
      description: 'Chrome profile directory (default: OS-appropriate path under tv-mcp-chrome)',
    },
    lanes: {
      type: 'string',
      short: 'l',
      description: 'Number of MCP lanes to register (1-26, default 6)',
    },
    port: {
      type: 'string',
      short: 'p',
      description: 'CDP port (default 9222)',
    },
  },
  handler: (opts) => {
    const laneCount = Math.max(1, Math.min(26, opts.lanes ? Number(opts.lanes) : 6));
    const lanes = Array.from({ length: laneCount }, (_, i) =>
      `tv-mcp-${String.fromCharCode(97 + i)}`
    );
    return setup({
      userDataDir: opts['user-data-dir'],
      lanes,
      port: opts.port ? Number(opts.port) : undefined,
    });
  },
});

export { setup, defaultProfilePath, buildMcpConfig };
