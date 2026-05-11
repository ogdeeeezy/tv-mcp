/**
 * Simple line-oriented logger with optional file output.
 * Enabled by setting TV_MCP_LOG_FILE. Always also writes to stderr.
 * mcp_log_tail returns the last N lines of the configured file.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOG_FILE = process.env.TV_MCP_LOG_FILE
  || (process.env.TV_MCP_LOG === '1' ? path.join(os.homedir(), '.tv-mcp.log') : null);

let stream = null;
if (LOG_FILE) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (err) {
    process.stderr.write(`[tv-mcp] failed to open log file ${LOG_FILE}: ${err.message}\n`);
  }
}

export function log(level, msg, extra) {
  const ts = new Date().toISOString();
  const line = extra
    ? `${ts} [${level}] ${msg} ${JSON.stringify(extra)}\n`
    : `${ts} [${level}] ${msg}\n`;
  if (stream) stream.write(line);
  if (level !== 'debug') process.stderr.write(line);
}

export function getLogFile() { return LOG_FILE; }

/**
 * Return last N lines of the log file (default 50).
 */
export async function tail({ lines = 50 } = {}) {
  if (!LOG_FILE) {
    return {
      success: false,
      error: 'Logging to file is disabled. Set TV_MCP_LOG_FILE=/path/to/log or TV_MCP_LOG=1 (defaults to ~/.tv-mcp.log) and restart the MCP.',
    };
  }
  try {
    const data = await fs.promises.readFile(LOG_FILE, 'utf8');
    const all = data.split('\n').filter(Boolean);
    return {
      success: true,
      log_file: LOG_FILE,
      total_lines: all.length,
      returned: Math.min(lines, all.length),
      lines: all.slice(-lines),
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: true, log_file: LOG_FILE, total_lines: 0, returned: 0, lines: [], note: 'Log file does not exist yet — nothing has been written.' };
    }
    throw err;
  }
}
