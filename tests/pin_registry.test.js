/**
 * Tests for the cross-instance pin registry.
 *
 * Each test uses a per-test registry path (via TV_MCP_REGISTRY_PATH) so they
 * don't collide with each other or any real registry on the dev machine. We
 * spawn worker subprocesses to simulate "another live tv-mcp instance" — using
 * a different PID is the only way to exercise the cross-process claim logic.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REGISTRY_MODULE = join(__dirname, '..', 'src', 'core', 'pin_registry.js');

// ── Harness ─────────────────────────────────────────────────────────────

let tmpDir;
let registryPath;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tv-mcp-registry-test-'));
  registryPath = join(tmpDir, 'registry.json');
  process.env.TV_MCP_REGISTRY_PATH = registryPath;
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env.TV_MCP_REGISTRY_PATH;
});

/**
 * Import a fresh copy of the registry module so module-level state is
 * re-evaluated (registryPath captured at import time). Required because
 * REGISTRY_PATH is read once at module load.
 */
async function freshRegistry() {
  const url = `${REGISTRY_MODULE}?t=${Date.now()}-${Math.random()}`;
  return import(url);
}

/**
 * Run a tiny child process that does ONE claim+exit, so we get a real
 * separate PID. Returns the child's exit info plus the registry state.
 */
function runWorkerClaim({ targetId, force = false, lane = null, holdMs = 0 }) {
  const script = `
    process.env.TV_MCP_REGISTRY_PATH = ${JSON.stringify(registryPath)};
    const { claim } = await import(${JSON.stringify(REGISTRY_MODULE)});
    try {
      const r = await claim(${JSON.stringify(targetId)}, { force: ${force}, lane: ${JSON.stringify(lane)} });
      process.stdout.write(JSON.stringify({ ok: true, pid: process.pid, result: r }));
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, pid: process.pid, error: err.message, code: err.code }));
    }
    ${holdMs > 0 ? `await new Promise(r => setTimeout(r, ${holdMs}));` : ''}
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, parsed: JSON.parse(res.stdout) };
}

// ── claim() basic ───────────────────────────────────────────────────────

describe('claim() — basic', () => {
  it('claims an unowned target', async () => {
    const { claim, list } = await freshRegistry();
    const r = await claim('tab-A');
    assert.equal(r.entry.pid, process.pid);
    assert.equal(r.displaced, null);
    const after = await list();
    assert.equal(after.pin_count, 1);
    assert.equal(after.pins[0].target_id, 'tab-A');
    assert.equal(after.pins[0].mine, true);
  });

  it('records hostname and claimedAt timestamp', async () => {
    const { claim } = await freshRegistry();
    const before = Date.now();
    const r = await claim('tab-B');
    const after = Date.now();
    assert.ok(r.entry.host && typeof r.entry.host === 'string');
    assert.ok(r.entry.claimedAt >= before && r.entry.claimedAt <= after);
  });

  it('records lane from argument', async () => {
    const { claim } = await freshRegistry();
    const r = await claim('tab-C', { lane: 'tv-mcp-a' });
    assert.equal(r.entry.lane, 'tv-mcp-a');
  });

  it('falls back to TV_MCP_LANE env var when lane arg omitted', async () => {
    process.env.TV_MCP_LANE = 'tv-mcp-b';
    try {
      const { claim } = await freshRegistry();
      const r = await claim('tab-D');
      assert.equal(r.entry.lane, 'tv-mcp-b');
    } finally {
      delete process.env.TV_MCP_LANE;
    }
  });

  it('throws on missing targetId', async () => {
    const { claim } = await freshRegistry();
    await assert.rejects(() => claim(''), /targetId/);
    await assert.rejects(() => claim(null), /targetId/);
  });

  it('re-claiming the same target by the same PID succeeds (idempotent)', async () => {
    const { claim } = await freshRegistry();
    await claim('tab-E');
    const r2 = await claim('tab-E');
    assert.equal(r2.entry.pid, process.pid);
  });
});

// ── conflict detection ──────────────────────────────────────────────────

describe('claim() — cross-process conflict', () => {
  it('refuses to claim a target owned by another live PID', async () => {
    // Hold a worker open while we try to claim from this process.
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      process.env.TV_MCP_REGISTRY_PATH = ${JSON.stringify(registryPath)};
      const { claim } = await import(${JSON.stringify(REGISTRY_MODULE)});
      await claim('tab-X', { lane: 'worker' });
      process.stdout.write('ready\\n');
      await new Promise(r => setTimeout(r, 2000));
    `], { stdio: ['ignore', 'pipe', 'pipe'] });

    // Wait for the child to signal it has claimed.
    await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', d => { buf += d; if (buf.includes('ready')) resolve(); });
      child.on('error', reject);
      setTimeout(() => reject(new Error('worker did not signal ready')), 3000);
    });

    try {
      const { claim } = await freshRegistry();
      await assert.rejects(
        () => claim('tab-X'),
        err => {
          assert.equal(err.code, 'PIN_CONFLICT');
          assert.equal(err.owner.pid, child.pid);
          assert.equal(err.owner.lane, 'worker');
          return true;
        }
      );
    } finally {
      child.kill('SIGTERM');
      await new Promise(r => child.on('exit', r));
    }
  });

  it('force=true overrides another live PID claim and reports displaced owner', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      process.env.TV_MCP_REGISTRY_PATH = ${JSON.stringify(registryPath)};
      const { claim } = await import(${JSON.stringify(REGISTRY_MODULE)});
      await claim('tab-Y', { lane: 'old' });
      process.stdout.write('ready\\n');
      await new Promise(r => setTimeout(r, 2000));
    `], { stdio: ['ignore', 'pipe', 'pipe'] });

    await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', d => { buf += d; if (buf.includes('ready')) resolve(); });
      setTimeout(() => reject(new Error('worker did not signal ready')), 3000);
    });

    try {
      const { claim } = await freshRegistry();
      const r = await claim('tab-Y', { force: true, lane: 'new' });
      assert.equal(r.entry.pid, process.pid);
      assert.equal(r.entry.lane, 'new');
      assert.ok(r.displaced, 'expected displaced owner info');
      assert.equal(r.displaced.pid, child.pid);
      assert.equal(r.displaced.lane, 'old');
    } finally {
      child.kill('SIGTERM');
      await new Promise(r => child.on('exit', r));
    }
  });
});

// ── dead-PID pruning ────────────────────────────────────────────────────

describe('dead-PID pruning', () => {
  it('automatically prunes entries whose PID has exited', async () => {
    // Write a registry entry with an impossible PID (max int — guaranteed dead).
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      pins: {
        'tab-zombie': { pid: 2147483646, host: 'ghost', lane: 'old', claimedAt: Date.now() - 60000 },
        'tab-mine': { pid: process.pid, host: 'me', lane: 'a', claimedAt: Date.now() },
      },
    }));

    const { list } = await freshRegistry();
    const r = await list();
    assert.equal(r.pin_count, 1);
    assert.equal(r.pins[0].target_id, 'tab-mine');

    // Verify the file was actually rewritten (prune persists).
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.equal(Object.keys(onDisk.pins).length, 1);
    assert.ok(!onDisk.pins['tab-zombie']);
  });

  it('claim() prunes dead-PID entries even when claiming a different target', async () => {
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      pins: {
        'tab-zombie': { pid: 2147483646, host: 'ghost', claimedAt: Date.now() - 60000 },
      },
    }));

    const { claim } = await freshRegistry();
    await claim('tab-new');
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.equal(Object.keys(onDisk.pins).length, 1);
    assert.ok(onDisk.pins['tab-new']);
    assert.ok(!onDisk.pins['tab-zombie']);
  });

  it('claim() succeeds against a dead-PID owner without needing force', async () => {
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      pins: {
        'tab-takeover': { pid: 2147483646, host: 'ghost', claimedAt: Date.now() - 60000 },
      },
    }));

    const { claim } = await freshRegistry();
    const r = await claim('tab-takeover');
    assert.equal(r.entry.pid, process.pid);
    // Dead-PID is pruned BEFORE the conflict check, so displaced should be null.
    assert.equal(r.displaced, null);
  });
});

// ── release ─────────────────────────────────────────────────────────────

describe('release()', () => {
  it('removes our own claim', async () => {
    const { claim, release, list } = await freshRegistry();
    await claim('tab-R');
    const r = await release('tab-R');
    assert.equal(r.released, true);
    const after = await list();
    assert.equal(after.pin_count, 0);
  });

  it('is a no-op when we do not own the target', async () => {
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      pins: {
        'tab-other': { pid: process.pid + 999999, host: 'other', claimedAt: Date.now() },
      },
    }));
    const { release } = await freshRegistry();
    const r = await release('tab-other');
    assert.equal(r.released, false);
    // Other process's claim must still be on disk
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.ok(onDisk.pins['tab-other']);
  });

  it('release() of missing target returns released=false', async () => {
    const { release } = await freshRegistry();
    const r = await release('tab-nope');
    assert.equal(r.released, false);
  });
});

// ── releaseAll ──────────────────────────────────────────────────────────

describe('releaseAll() / releaseAllSync()', () => {
  it('releases every pin owned by this PID, leaves others', async () => {
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      pins: {
        'tab-A': { pid: process.pid, claimedAt: Date.now() },
        'tab-B': { pid: process.pid, claimedAt: Date.now() },
        'tab-other': { pid: process.pid + 999999, claimedAt: Date.now() },
      },
    }));
    const { releaseAll } = await freshRegistry();
    await releaseAll();
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.equal(Object.keys(onDisk.pins).length, 1);
    assert.ok(onDisk.pins['tab-other']);
  });

  it('releaseAllSync() works without await (for process.exit handlers)', async () => {
    const { claim, releaseAllSync } = await freshRegistry();
    await claim('tab-sync');
    releaseAllSync();
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.equal(Object.keys(onDisk.pins).length, 0);
  });
});

// ── corruption tolerance ────────────────────────────────────────────────

describe('corruption tolerance', () => {
  it('treats a corrupt registry file as empty and repairs it', async () => {
    writeFileSync(registryPath, 'this is not json {{{');
    const { claim, list } = await freshRegistry();
    const r = await claim('tab-repair');
    assert.equal(r.entry.pid, process.pid);
    const after = await list();
    assert.equal(after.pin_count, 1);
    // File should now be valid JSON
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.equal(onDisk.version, 1);
  });

  it('treats a missing registry file as empty', async () => {
    const { list } = await freshRegistry();
    const r = await list();
    assert.equal(r.pin_count, 0);
    // list() doesn't write the file if there's nothing to prune
    assert.equal(existsSync(registryPath), false);
  });

  it('treats a missing pins field as empty', async () => {
    writeFileSync(registryPath, JSON.stringify({ version: 1 }));
    const { list } = await freshRegistry();
    const r = await list();
    assert.equal(r.pin_count, 0);
  });
});

// ── atomic-ish writes ───────────────────────────────────────────────────

describe('write atomicity', () => {
  it('never leaves a half-written registry file', async () => {
    const { claim } = await freshRegistry();
    // Do many sequential claims+releases. After each, file must be parseable.
    for (let i = 0; i < 20; i++) {
      await claim(`tab-${i}`);
      const txt = readFileSync(registryPath, 'utf8');
      const parsed = JSON.parse(txt);
      assert.equal(parsed.version, 1);
      assert.ok(parsed.pins[`tab-${i}`]);
    }
  });
});
