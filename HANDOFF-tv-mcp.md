# HANDOFF-tv-mcp

> Fork at `ogdeeeezy/tv-mcp` (split 2026-05-11 from `~/tradibos/`).

## Current state

**Fix 1+2 (commit `a3cfcd6`) regression caught + 5-site patch applied on disk, awaiting Claude Code restart to verify.** Fix 3 shipped 2026-06-05.

Session 10 live integration test through the actual MCP tools failed at step 1: `pine_new` throws `m.editor.getEditors is not a function`. Root cause: `FIND_MONACO` returns `{editor: <Monaco instance>, env: <namespace>}` but the 5 new consumers in `a3cfcd6` call `m.editor.getEditors()[0]` as if `m` were the monaco namespace. Editor instances have no `.getEditors()`. Pre-Fix1+2 consumers (`9274ff3`, still in the file) correctly use `m.editor.setValue(...)` etc.

5-site mechanical patch on disk (uncommitted): `m.editor.getEditors()[0]` → `m.editor` at L438/602/819/842; `m.editor.getEditors()[0].getValue()` → `m.editor.getValue()` at L532. 50/50 offline unit tests still pass. Patched code is JS-template strings; verification requires Claude Code restart.

## Immediate next action

1. **Restart Claude Code.** MCP processes are frozen on pre-patch code (retried `pine_new` after the disk edit and got the same error from PID 50884).
2. **Re-run the Session 9 live test:**
   - Free lane → `tab_pin` a chart → `pine_claim`
   - `pine_new(type='indicator')` → expect `action: 'unbound_draft_created'`
   - `pine_set_source({source: '//@version=6\nindicator("tv-mcp-restart-test-<ts>")\nplot(close)'})`
   - `pine_save({name: 'tv-mcp-restart-test-<ts>'})` → expect `success: true, action: 'saved_as_new', scriptIdPart: <id>, verified: true`
   - `pine_list_scripts` → confirm new entry; `pine_get_source` → confirm source matches
3. **If green:** commit `fix(pine): FIND_MONACO return-shape mismatch in Fix 1+2 (5 sites)`. Then clean up the 5 leftover probes (4 `tvmcp_probe_*` / `tvmcp_fix1_e2e_*` + the new restart-test). `POST /pine-facade/delete/<urlencoded-id>` returns 401 "not an owner" and `DELETE` is CORS-blocked from page context — capture the real endpoint via Chrome devtools while deleting one via the TV UI.
4. **If still red:** `git diff src/core/pine.js HEAD` to confirm the patch is on disk; verify the six MCP child node processes actually restarted (fresh start times in `ps aux | grep tv-mcp`).

## Reference (still valid from Session 9)
- `POST /pine-facade/save/new?name=<urlencoded>&allow_overwrite=true|false` (FormData `source=`) → creates slot, returns `body.result.metaInfo.scriptIdPart`. TV normalizes line-endings to `\r\n`.
- `GET /pine-facade/get/<urlencoded-id>/<version|"last">` → fetches source.
- Monaco actions reachable via `editor.getSupportedActions()`: `new_indicator`, `new_strategy`, `open.script`, etc. (`.run()` them).
- Monaco commands NOT in actions: `:save.script` via `editor._commandService.executeCommand` (gated on `isSaveEnabled`).
- Title button `[data-qa-id="pine-script-title-button"]` shows bound slot name or "Untitled script".

## Known gotchas
- **FIND_MONACO returns `{editor, env}` NOT the monaco namespace.** `m.editor` = editor instance (has `setValue`/`getValue`/`getModel`/`getSupportedActions`). `m.env` = namespace (has `editor.getEditors`). Session 10's regression was getting this backwards.
- **MCP processes don't hot-reload.** Restart Claude Code to pick up `src/` edits.
- **Singleton pine_editor claim is account-global.** Two MCP processes can't both write Pine — escape hatch is `TV_MCP_PINE_WRITE_UNGATED=1`.
- **`ui_evaluate` does NOT await Promises** — async IIFEs return `{}`. Stash result on `window.__X`, poll via subsequent sync evaluate.
- **`evaluate` alias trap** in `src/core/chart.js`/`drawing.js`/`replay.js`: imported as `_evaluate`, requires `const { evaluate } = _resolve(_deps)` before bare calls.
- **`chrome_launch`'s 5s wait can be a false negative** on cold starts — probe `chrome_health` before assuming failure.
- **Pin state ≠ registry state.** `setPin`/`clearPin` in `connection.js` are in-process-only; `claimAndPin`/`releaseAndUnpin` also touch `~/.tv-mcp-registry.json`. Tools go through the registry path; internal reconnect uses bare `setPin`.

## Hot files
- `src/core/pine.js` — uncommitted Session-10 patch at L438/532/602/819/842 (FIND_MONACO consumer fix).
- `src/core/pin_registry.js` — v2 with pine_editor singleton (Fix 3).
- `src/tools/pine.js` — claim/release/status tools at the bottom.
- `tests/pin_registry.test.js` — 12 pine_editor cases.
- `SPEC-pine-safe-create.md`, `INCIDENT-pine-overwrite-2026-06-05.md`.

## Related repos
- `~/tradibos/`, `~/lib/schwab-market-data/` + `/root/schwab-market-data/` on H2, `~/tradibos-nautilus/` on H2 (Pine slot blocked).

## Open questions for user
None.
