/**
 * Unit tests for `tv setup` pure helpers.
 * The chromeLaunch side-effect is not exercised here — that's e2e territory.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { defaultProfilePath, buildMcpConfig } from '../src/cli/commands/setup.js';

describe('defaultProfilePath', () => {
  test('returns a string under the user home dir', () => {
    const p = defaultProfilePath();
    assert.equal(typeof p, 'string');
    assert.ok(p.length > 0);
    // On macOS/Linux the home dir prefix is direct; on Windows %LOCALAPPDATA% may
    // resolve elsewhere — so we just require a non-empty path with our slug.
    assert.match(p, /tv-mcp-chrome$/);
  });

  test('matches the platform-appropriate location', () => {
    const p = defaultProfilePath();
    const home = os.homedir();
    if (process.platform === 'darwin') {
      assert.equal(p, path.join(home, 'Library', 'Application Support', 'tv-mcp-chrome'));
    } else if (process.platform === 'linux') {
      // XDG_CONFIG_HOME may be set in CI — accept either.
      const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
      assert.equal(p, path.join(xdg, 'tv-mcp-chrome'));
    }
    // Windows path checking is environment-sensitive; just verify the slug.
  });
});

describe('buildMcpConfig', () => {
  test('produces six lanes by default lane list', () => {
    const lanes = ['tv-mcp-a', 'tv-mcp-b', 'tv-mcp-c', 'tv-mcp-d', 'tv-mcp-e', 'tv-mcp-f'];
    const cfg = buildMcpConfig(lanes);
    assert.equal(Object.keys(cfg.mcpServers).length, 6);
    for (const lane of lanes) {
      assert.ok(cfg.mcpServers[lane], `missing lane ${lane}`);
      assert.equal(cfg.mcpServers[lane].command, 'node');
      assert.ok(Array.isArray(cfg.mcpServers[lane].args));
      assert.ok(cfg.mcpServers[lane].args[0].endsWith('server.js'));
    }
  });

  test('single-lane config has just one entry', () => {
    const cfg = buildMcpConfig(['tv-mcp-a']);
    assert.equal(Object.keys(cfg.mcpServers).length, 1);
    assert.ok(cfg.mcpServers['tv-mcp-a']);
  });

  test('all lanes point to the same server.js absolute path', () => {
    const cfg = buildMcpConfig(['tv-mcp-a', 'tv-mcp-b']);
    const a = cfg.mcpServers['tv-mcp-a'].args[0];
    const b = cfg.mcpServers['tv-mcp-b'].args[0];
    assert.equal(a, b);
    assert.ok(path.isAbsolute(a), `expected absolute path, got ${a}`);
  });
});
