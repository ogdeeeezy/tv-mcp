# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp` (split 2026-05-11 from `~/tradibos/`).

## Current state

**v1.0.1 shipped. 2026-06-07: Fix 1 and Fix 2 implemented + live-tested end-to-end.** Awaiting MCP restart to verify through the actual tools. Fix 3 shipped 2026-06-05.

### What Fix 3 covers
Multi-instance Pine editor claim registry. `~/.tv-mcp-registry.json` now v2 with a global `pine_editor` singleton slot. Tools: `pine_claim`, `pine_release`, `pine_claim_status`. Every Pine write tool (`pine_new`, `pine_set_source`, `pine_save`, `pine_smart_compile`, `pine_compile`) refuses to run without a claim — returns `PINE_NOT_CLAIMED` or `PINE_CLAIMED_BY_OTHER` with owner info. Escape hatch: `TV_MCP_PINE_WRITE_UNGATED=1`. Exit handler clears the slot. 12 new tests, 34/34 pin_registry pass, 47/47 other unit tests pass. **MCP processes do not hot-reload — Fix 3 only takes effect after a Claude Code restart.**

### What Fix 3 does NOT cover (still queued)
- **Fix 1 — `pine_new` actually creates a server-side slot.** Currently still rebinds editor to whatever script was last loaded (the data-loss bug). Spec: `SPEC-pine-safe-create.md`. Gated on discovering the pine-facade create endpoint via Chrome network capture (probe attempted, paused mid-session).
- **Fix 2 — verified `pine_save`.** Currently dispatches Ctrl+S and reports `success: true` even when focus was wrong and nothing persisted. Use Monaco action `vs.editor.ICodeEditor:1:save.script` (proven in the 2026-06-05 recovery) + pine-facade `/get/{id}/last` poll.
- **Fix 4 — pre-flight snapshot hook (defense in depth, deferred until 1+2 are stable).** Auto-fires inside `pine_claim`: snapshots `pine_list_scripts` + per-script `/get/<id>/last` source bodies to `~/.tv-mcp-snapshots/preflight-<lane>-<ts>.json`, records editor's current binding. On `pine_release` or process exit, diffs versions and loudly flags any version bump on a pre-existing slot (i.e., a slot the lane shouldn't have touched). Rotation: keep last 20. Decision 2026-06-07: do NOT build until 1+2 have shipped and run a few real Pine sessions without incident — pre-flight is the safety net for unknown future bugs, not a substitute for fixing the known ones. Layer C (per-instance Chrome profiles) is DEAD — TV ToS prohibits concurrent sessions per account.

### Blocked downstream
`tradibos-nautilus` Pine ingestion for the three-way compare harness on H2 (`/root/tradibos-nautilus/harness/three_way_compare.py`). PyParity + Nautilus lanes work; Pine slot stays empty until Fix 1+2 ship.

## Immediate next action

1. **Restart Claude Code** so MCP lanes pick up the new Fix 1+2 code in `src/core/pine.js`. New tool signatures: `pine_new({type, name?, source?})` and `pine_save({name?, verify_timeout_ms?})`.
2. **Live integration test through MCP:**
   - Pin lane (any free), claim Pine.
   - `pine_new(type='indicator')` → expect `action: 'unbound_draft_created'`, title button shows "Untitled script".
   - `pine_set_source({source: '//@version=6\nindicator("tv-mcp-restart-test-<ts>")\nplot(close)'})`.
   - `pine_save({name: 'tv-mcp-restart-test-<ts>'})` → expect `success: true, action: 'saved_as_new', scriptIdPart: <real id>, verified: true`.
   - `pine_list_scripts` → confirm new entry exists.
   - `pine_get_source` → confirm source matches what we set.
3. **Cleanup probe scripts** from Session 9 — four `tvmcp_probe_*` / `tvmcp_fix1_e2e_*` entries plus the restart-test one. Either via TV UI or by probing the delete endpoint (likely `/pine-facade/delete/<id>`, not captured Session 9).

## Discovered endpoints (Session 9 probe)

- `POST https://pine-facade.tradingview.com/pine-facade/save/new?name=<urlencoded>&allow_overwrite=true|false` with FormData body `source=<pine source>` → creates new cloud script slot. Response: `{success: true, result: {metaInfo: {scriptIdPart, description, pine: {version}, ...}}}`.
- `POST https://pine-facade.tradingview.com/pine-facade/parse_title` with FormData `source=` → extracts title from source code.
- `GET https://pine-facade.tradingview.com/pine-facade/get/<urlencoded-id>/<version|"last">` → fetches versioned source.
- TV normalizes line endings to `\r\n` on store — verify-poll comparison must normalize before equality.

## Monaco editor primitives (Session 9 probe)

- Actions: `vs.editor.ICodeEditor:1:new_indicator`, `:new_strategy`, `:open.script`, `:detach.window`, `:detach.tab`, `:add.to.chart`, `:discard_all_changes`, `:open.history` — all in `editor.getSupportedActions()`. Call `.run()`.
- Commands (NOT in getSupportedActions but reachable via `editor._commandService.executeCommand`): `:save.script`, gated on context key `isSaveEnabled && editorId == 'vs.editor.ICodeEditor:1'`.
- Editor binding: title button `[data-qa-id="pine-script-title-button"]` shows current bound slot name, or "Untitled script" when unbound.
- `new_indicator`/`new_strategy` is purely client-side (zero network) — it swaps Monaco to a new unbound model. Safe to call without any cloud side effects.

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
