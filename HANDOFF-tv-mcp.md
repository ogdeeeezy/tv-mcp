# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp` (split 2026-05-11 from `~/tradibos/`).

## Current state

**v1.0.1 shipped. 2026-06-05: Fix 3 of 3 from the pine-overwrite incident shipped (`2f4fbb6`).** Fixes 1 and 2 still queued.

### What Fix 3 covers
Multi-instance Pine editor claim registry. `~/.tv-mcp-registry.json` now v2 with a global `pine_editor` singleton slot. Tools: `pine_claim`, `pine_release`, `pine_claim_status`. Every Pine write tool (`pine_new`, `pine_set_source`, `pine_save`, `pine_smart_compile`, `pine_compile`) refuses to run without a claim — returns `PINE_NOT_CLAIMED` or `PINE_CLAIMED_BY_OTHER` with owner info. Escape hatch: `TV_MCP_PINE_WRITE_UNGATED=1`. Exit handler clears the slot. 12 new tests, 34/34 pin_registry pass, 47/47 other unit tests pass. **MCP processes do not hot-reload — Fix 3 only takes effect after a Claude Code restart.**

### What Fix 3 does NOT cover (still queued)
- **Fix 1 — `pine_new` actually creates a server-side slot.** Currently still rebinds editor to whatever script was last loaded (the data-loss bug). Spec: `SPEC-pine-safe-create.md`. Gated on discovering the pine-facade create endpoint via Chrome network capture (probe attempted, paused mid-session).
- **Fix 2 — verified `pine_save`.** Currently dispatches Ctrl+S and reports `success: true` even when focus was wrong and nothing persisted. Use Monaco action `vs.editor.ICodeEditor:1:save.script` (proven in the 2026-06-05 recovery) + pine-facade `/get/{id}/last` poll.

### Blocked downstream
`tradibos-nautilus` Pine ingestion for the three-way compare harness on H2 (`/root/tradibos-nautilus/harness/three_way_compare.py`). PyParity + Nautilus lanes work; Pine slot stays empty until Fix 1+2 ship.

## Immediate next action

1. **Restart Claude Code** so the MCP processes load Fix 3 code (`pine_claim`/`pine_release`/`pine_claim_status` tools appear, registry write migrates to v2).
2. **Re-pin and re-instrument** the network probe — the live state from Session 8 is gone after restart:
   - `tab_pin url=YKaDEilf` on lane `tv-mcp-e` (or pick a fresh chart)
   - Re-install fetch+XHR interceptor in the page (snippet preserved in PROGRESS S8 + recap HTML)
   - `pine_claim` to take the new claim gate
3. **Trigger TV's "New script" UI flow programmatically** — open Pine Editor, find the file/menu dropdown (was not visible to my prior `data-name="open-script"` / aria-label search; may need a more targeted selector or a manual user click while the interceptor is hot). Capture the POST URL + method + body shape from `window.__pineProbe.calls`.
4. **Implement Fix 1** in `src/core/pine.js:newScript` — POST to discovered endpoint, then call `openScript()` to rebind, return real `scriptIdPart`.
5. **Implement Fix 2** in `src/core/pine.js:save` — switch from Ctrl+S dispatch to Monaco action + pine-facade verify-poll.
6. **Restart Claude Code again, live integration test:** two `pine_new` calls → +2 `pine_list_scripts` entries with `tv-mcp-probe-<unix-ts>` names; `pine_set_source` + `pine_save` + verify roundtrip via pine-facade `/get/.../last`. Probe scripts pre-approved as throwaway — delete after.

## When to open this project again

- **NOW**: Fix 1+2 above. tradibos-nautilus is blocked.
- A friend installs from the GH release and hits a bug — file an issue, fix on a branch, cut v1.0.2.
- Upstream `tradesdontlie/tradingview-mcp` lands a change worth vendoring.
- A new feature ask.

## Known gotchas (read before editing `src/`)

- **MCP server processes don't hot-reload.** Six `tv-mcp-a..f` processes spawn at Claude Code session start and freeze on that code. To pick up `src/` changes, restart Claude Code. Fix 3 is in code but the running processes don't yet know about `pine_claim` until the next restart.
- **Singleton pine_editor claim is account-global, not per-tab.** Two MCP processes on the same Chrome cannot both write Pine code — only one can hold the claim. This is intentional because TV cloud script slots are account-shared. To work around: split into separate Chrome user-data-dirs (spec Layer C, not built).
- **`evaluate` alias trap** in `src/core/chart.js`, `src/core/drawing.js`, `src/core/replay.js`: module imports `evaluate as _evaluate`, so bare `evaluate(...)` calls only work after `const { evaluate } = _resolve(_deps);`. New functions must mimic the existing ones.
- **Pin state ≠ registry state.** `setPin`/`clearPin` in `connection.js` are in-process-only (transient reconnect). `claimAndPin`/`releaseAndUnpin` also touch `~/.tv-mcp-registry.json`. Tools use the registry path; internal reconnect must use bare `setPin`.
- **vm-context object identity** (S5) — `assert.deepEqual({}, vmCtx.metrics)` fails strict-equality even when both are empty. Use `Object.keys(...).length === 0` for empty-object checks across realms. See `tests/data_strategy_helpers.test.js`.
- **`chrome_launch`'s 5s wait can be a false negative** on truly cold starts. If it returns `launched_but_not_responsive`, probe `chrome_health` once before assuming failure.
- **`mcp_log_tail` is opt-in.** Set `TV_MCP_LOG=1` or `TV_MCP_LOG_FILE=/path` at server start.

## Hot files

- `src/core/pin_registry.js` — extended with pine_editor slot (S8). v1→v2 migration is transparent.
- `src/core/pine.js` — `requirePineClaim()` gate at top of every write function. `pineClaim`/`pineRelease`/`pineClaimStatus` exports. **Fix 1+2 live here** (`newScript` at ~line 508 of pre-S8 code, `save` at ~line 347).
- `src/tools/pine.js` — three new MCP tools at the bottom.
- `tests/pin_registry.test.js` — 12 new pine_editor cases at the bottom.
- `SPEC-pine-safe-create.md` — the spec for Fix 1+2. Open questions there gate Fix 1.
- `INCIDENT-pine-overwrite-2026-06-05.md` — full repro and recovery.

## Related repos / locations

- `~/tradibos/` (strategy library, `ogdeeeezy/tradibos`)
- `~/lib/schwab-market-data/` and `/root/schwab-market-data/` on H2 (paper trader using v6a CL on `NYMEX:CL1!`).
- `~/tradibos-nautilus/` on H2 — Pine slot in three-way harness is blocked.

## Open questions for user

None.
