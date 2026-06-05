/**
 * Cross-instance pin registry.
 *
 * Multiple Claude Code sessions can each run their own tv-mcp processes against
 * the same Chrome (port 9222). Pins are per-process, so without coordination two
 * processes could claim the same tab and race against each other on every CDP
 * call. This module records {targetId → owner-pid} in a shared JSON file so
 * claim() can refuse double-claims (or force-override with explicit intent).
 *
 * Storage: ~/.tv-mcp-registry.json
 * Locking: ~/.tv-mcp-registry.lock (exclusive O_CREAT, retry+backoff, stale break)
 * Liveness: process.kill(pid, 0) — throws ESRCH for dead PIDs, entries pruned on read.
 */
import { readFileSync, writeFileSync, existsSync, renameSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname } from 'node:os';

const REGISTRY_PATH = process.env.TV_MCP_REGISTRY_PATH || join(homedir(), '.tv-mcp-registry.json');
const LOCK_PATH = REGISTRY_PATH + '.lock';
const LOCK_STALE_MS = 5000;
const LOCK_RETRY_MS = 25;
const LOCK_MAX_WAIT_MS = 2000;
const REGISTRY_VERSION = 2;

function isAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive
    return err.code === 'EPERM';
  }
}

function emptyRegistry() {
  return { version: REGISTRY_VERSION, pins: {}, pine_editor: null };
}

function readRaw() {
  if (!existsSync(REGISTRY_PATH)) return emptyRegistry();
  try {
    const txt = readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(txt);
    if (!parsed || typeof parsed !== 'object' || !parsed.pins) return emptyRegistry();
    // v1 → v2 migration: ensure pine_editor field exists (null = unclaimed)
    if (!('pine_editor' in parsed)) parsed.pine_editor = null;
    return parsed;
  } catch {
    // Corrupt registry — treat as empty. A subsequent write will repair it.
    return emptyRegistry();
  }
}

function writeAtomic(data) {
  const tmp = REGISTRY_PATH + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, REGISTRY_PATH);
}

async function acquireLock() {
  const start = Date.now();
  while (Date.now() - start < LOCK_MAX_WAIT_MS) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      closeSync(fd);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Break stale lock if older than LOCK_STALE_MS
      try {
        const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
        if (age > LOCK_STALE_MS) {
          try { unlinkSync(LOCK_PATH); } catch {}
          continue;
        }
      } catch {}
      await new Promise(r => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  throw new Error(`Could not acquire pin-registry lock at ${LOCK_PATH} within ${LOCK_MAX_WAIT_MS}ms`);
}

function releaseLock() {
  try { unlinkSync(LOCK_PATH); } catch {}
}

/**
 * Read the registry, prune dead-PID entries, and persist the cleaned version
 * before returning. Callers can trust the returned `pins` map to reflect only
 * live owners. Holds the lock for the read-modify-write cycle.
 */
async function readAndPrune() {
  await acquireLock();
  try {
    const reg = readRaw();
    let mutated = false;
    for (const [targetId, entry] of Object.entries(reg.pins)) {
      if (!isAlive(entry?.pid)) {
        delete reg.pins[targetId];
        mutated = true;
      }
    }
    if (reg.pine_editor && !isAlive(reg.pine_editor.pid)) {
      reg.pine_editor = null;
      mutated = true;
    }
    if (mutated) writeAtomic(reg);
    return reg;
  } finally {
    releaseLock();
  }
}

/**
 * Claim a target for this process. Returns the recorded entry on success.
 * Throws if another live PID owns it (unless `force: true`).
 *
 * On force, any previous owner entry for that targetId is replaced and the
 * displaced owner info is returned in `displaced` for telemetry.
 */
export async function claim(targetId, { force = false, lane = null } = {}) {
  if (!targetId) throw new Error('claim requires a targetId');
  await acquireLock();
  try {
    const reg = readRaw();
    // Prune in-place
    for (const [tid, entry] of Object.entries(reg.pins)) {
      if (!isAlive(entry?.pid)) delete reg.pins[tid];
    }
    if (reg.pine_editor && !isAlive(reg.pine_editor.pid)) reg.pine_editor = null;
    const existing = reg.pins[targetId];
    if (existing && existing.pid !== process.pid) {
      if (!force) {
        const err = new Error(
          `Tab ${targetId} is already pinned by pid=${existing.pid} (lane=${existing.lane || 'unknown'}, host=${existing.host}, since ${new Date(existing.claimedAt).toISOString()}). ` +
          `Use force=true to override.`
        );
        err.code = 'PIN_CONFLICT';
        err.owner = existing;
        throw err;
      }
    }
    const entry = {
      pid: process.pid,
      host: hostname(),
      lane: lane || process.env.TV_MCP_LANE || null,
      claimedAt: Date.now(),
    };
    const displaced = existing && existing.pid !== process.pid ? existing : null;
    reg.pins[targetId] = entry;
    writeAtomic(reg);
    return { entry, displaced };
  } finally {
    releaseLock();
  }
}

/**
 * Release any pin owned by this process for `targetId`. Idempotent — succeeds
 * silently if we don't own it or it doesn't exist.
 */
export async function release(targetId) {
  if (!targetId) return { released: false };
  await acquireLock();
  try {
    const reg = readRaw();
    const existing = reg.pins[targetId];
    if (existing && existing.pid === process.pid) {
      delete reg.pins[targetId];
      writeAtomic(reg);
      return { released: true };
    }
    return { released: false };
  } finally {
    releaseLock();
  }
}

/**
 * Release every pin owned by this process. Called on process exit.
 */
export async function releaseAll() {
  await acquireLock();
  try {
    const reg = readRaw();
    let mutated = false;
    for (const [tid, entry] of Object.entries(reg.pins)) {
      if (entry?.pid === process.pid) {
        delete reg.pins[tid];
        mutated = true;
      }
    }
    if (reg.pine_editor && reg.pine_editor.pid === process.pid) {
      reg.pine_editor = null;
      mutated = true;
    }
    if (mutated) writeAtomic(reg);
    return { released_count: Object.keys(reg.pins).length };
  } finally {
    releaseLock();
  }
}

/**
 * List all live pins. Dead-PID entries are pruned as a side effect.
 */
export async function list() {
  const reg = await readAndPrune();
  return {
    registry_path: REGISTRY_PATH,
    version: reg.version || REGISTRY_VERSION,
    pin_count: Object.keys(reg.pins).length,
    pins: Object.entries(reg.pins).map(([targetId, entry]) => ({
      target_id: targetId,
      ...entry,
      mine: entry.pid === process.pid,
    })),
    pine_editor: reg.pine_editor
      ? { ...reg.pine_editor, mine: reg.pine_editor.pid === process.pid }
      : null,
  };
}

/**
 * Synchronous best-effort cleanup. Used in process exit handlers where the
 * event loop is unavailable.
 */
export function releaseAllSync() {
  try {
    // Best-effort: try to take the lock briefly, but don't block exit.
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      closeSync(fd);
    } catch {
      // Couldn't take lock — proceed without it. Worst case is a momentary
      // conflicting write; the next live process to read will prune our entry
      // anyway because our PID will be dead.
    }
    try {
      const reg = readRaw();
      let mutated = false;
      for (const [tid, entry] of Object.entries(reg.pins)) {
        if (entry?.pid === process.pid) {
          delete reg.pins[tid];
          mutated = true;
        }
      }
      if (reg.pine_editor && reg.pine_editor.pid === process.pid) {
        reg.pine_editor = null;
        mutated = true;
      }
      if (mutated) writeAtomic(reg);
    } finally {
      try { unlinkSync(LOCK_PATH); } catch {}
    }
  } catch {
    // Swallow — we're exiting anyway.
  }
}

// ── Pine editor claim ──────────────────────────────────────────────────────
//
// The Pine Editor in TV is a singleton bottom-widget per tab, but the underlying
// script slots are shared across the whole TradingView account (and therefore
// across every Chrome tab and every MCP process touching this Chrome). Two
// instances both calling `pine_set_source` + save will race on the cloud slot
// and the second save overwrites the first — exactly the failure mode that
// destroyed W-Bottom v5 PROP TUNED on 2026-06-05.
//
// This claim is GLOBAL (one across the registry, not per-tab) because the
// blast radius of a save is global. The single-slot semantics mirror the spec's
// Layer A in SPEC-pine-safe-create.md.

/**
 * Claim the global Pine editor for this process. Throws PIN_CONFLICT if another
 * live PID holds it (unless `force: true`).
 */
export async function claimPineEditor({ force = false, lane = null, scriptIdPart = null } = {}) {
  await acquireLock();
  try {
    const reg = readRaw();
    if (reg.pine_editor && !isAlive(reg.pine_editor.pid)) reg.pine_editor = null;
    const existing = reg.pine_editor;
    if (existing && existing.pid !== process.pid) {
      if (!force) {
        const err = new Error(
          `Pine editor is claimed by pid=${existing.pid} (lane=${existing.lane || 'unknown'}, host=${existing.host}, since ${new Date(existing.claimedAt).toISOString()}). ` +
          `Call pine_release from that process, or retry with force=true to override.`
        );
        err.code = 'PINE_CONFLICT';
        err.owner = existing;
        throw err;
      }
    }
    const entry = {
      pid: process.pid,
      host: hostname(),
      lane: lane || process.env.TV_MCP_LANE || null,
      claimedAt: Date.now(),
      scriptIdPart: scriptIdPart || null,
    };
    const displaced = existing && existing.pid !== process.pid ? existing : null;
    reg.pine_editor = entry;
    writeAtomic(reg);
    return { entry, displaced };
  } finally {
    releaseLock();
  }
}

/**
 * Release the Pine editor claim if held by this process. Idempotent.
 */
export async function releasePineEditor() {
  await acquireLock();
  try {
    const reg = readRaw();
    const existing = reg.pine_editor;
    if (existing && existing.pid === process.pid) {
      reg.pine_editor = null;
      writeAtomic(reg);
      return { released: true };
    }
    return { released: false };
  } finally {
    releaseLock();
  }
}

/**
 * Read the current Pine editor claim (with stale-PID prune). Returns the live
 * claim entry or null. Read-only from the caller's perspective.
 */
export async function getPineEditorClaim() {
  const reg = await readAndPrune();
  return reg.pine_editor;
}

export { REGISTRY_PATH };
