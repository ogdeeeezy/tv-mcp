# PROGRESS-tv-mcp

> Sessions 1-7 archived → `docs/archive/archive-progress-tv-mcp.md`

---

## Session 10: 2026-06-08 — Fix 1+2 regression caught post-restart, 5-site patch

### Done
- **Live integration test of Fix 1+2 — FAILED on actual MCP tools.** Claimed Pine on lane `tv-mcp-a` (chart `YKaDEilf`), called `pine_new(type='indicator')` → `TypeError: m.editor.getEditors is not a function at <anonymous>:32:29`. Same error on retry.
- **Root cause via direct page probe.** `FIND_MONACO` returns `{editor: <Monaco editor instance>, env: <monaco namespace>}` — `m.editor` is the editor INSTANCE (has `setValue`/`getValue`/`getModel`/`getSupportedActions`, no `getEditors`); `m.env.editor.getEditors` is the namespace method. The 5 new callsites in Fix 1+2 commit `a3cfcd6` (lines 438, 532, 602, 819, 842) wrote `m.editor.getEditors()[0]` as if `m` were the monaco namespace. Pre-`a3cfcd6` consumers (commit `9274ff3`, still in the file) use `m.editor.setValue(...)` / `m.editor.getValue()` correctly — they treat `m.editor` as the instance. Fix 1+2 wrote against a different mental model of FIND_MONACO's return shape.
- **5-site mechanical patch applied on disk (uncommitted).** `m.editor.getEditors()[0]` → `m.editor` at L438/602/819/842; `m.editor.getEditors()[0].getValue()` → `m.editor.getValue()` at L532. `grep getEditors src/core/pine.js` confirms only the legitimate FIND_MONACO internals at L94-95 remain.
- **Confirmed MCP processes are frozen on pre-patch code.** Re-ran `pine_new(type='indicator')` after the disk edits — same error from PID 50884. Verifies the HANDOFF gotcha; restart is the only verification path from here.
- **50/50 offline unit tests still pass** (`pine_analyze.test.js` + `pin_registry.test.js`). The patched code is JS-template strings injected via CDP — not exercised by Node-level tests.
- **Delete-endpoint probe inconclusive (2-strike pivot).** `POST /pine-facade/delete/<urlencoded-id>` returned 401 `{"code":401,"message":"User is not an owner of pine"}` — surprising since the same cookies POST happily to `/save/new`. `DELETE` method CORS-blocked from page context. Stopped probing per empty-data-pivot; capture the real endpoint via Chrome devtools while deleting one through TV UI.

### Decisions
- **Patch left uncommitted at session end.** Verification requires a Claude Code restart that no in-session action can trigger. Next instance runs the live test first, then commits the patch with whatever wording the verification proof supports. Committing now would couple "patch correctness" to "still works on restart" with no proof for either claim.
- **Did not delete the 4 Session 9 probe scripts.** Delete endpoint not captured; user can clean up via TV UI in seconds.

### Next
- **Restart Claude Code + re-run Session 9 live test sequence** through the MCP tools (`pine_new` → `pine_set_source` → `pine_save({name})` → `pine_list_scripts` → `pine_get_source`). If green, commit the patch with message `fix(pine): FIND_MONACO return-shape mismatch in Fix 1+2 (5 sites)`.
- **Cleanup the 5 probe scripts** (4 from Session 9 + the new `tv-mcp-restart-test-<ts>`) — via TV UI, capturing the delete endpoint via devtools.
- **Fix 4 still queued** (pre-flight snapshot hook) — deferred until Fix 1+2 verified post-restart and run a few real sessions clean.

---

## Session 9: 2026-06-07 — Fix 1 + Fix 2 implemented, endpoint discovered

### Done
- **Network probe completed** — discovered the pine-facade create endpoint and full save-new flow via live capture on lane `tv-mcp-a` (chart YKaDEilf). Three calls: `GET /pine-facade/list?filter=saved` → `POST /pine-facade/parse_title` (FormData `source=`) → `POST /pine-facade/save/new?name=<urlencoded>&allow_overwrite=true` (FormData `source=`). Response body shape: `{success: true, result: {metaInfo: {scriptIdPart, description, pine: {version}, ...}}}`.
- **Monaco action discovery** — TV registers `vs.editor.ICodeEditor:1:new_indicator`, `new_strategy`, `open.script`, `save.script` as command/action handlers on the Pine editor's Monaco instance. `new_indicator`/`new_strategy` are pure client-side primitives that swap the editor to a fresh unbound Monaco model (zero network, zero cloud side effect) — the missing safety mechanism the old `pine_new` should have used. `save.script` is gated on context key `isSaveEnabled && editorId == 'vs.editor.ICodeEditor:1'`.
- **Editor binding-state detection** — TV's `[data-qa-id="pine-script-title-button"]` shows the bound script name, or "Untitled script" when the editor is unbound. This is the reliable signal for distinguishing the bound (overwrite-risk) vs unbound (safe-to-save-new) cases.
- **Fix 1 shipped** (`src/core/pine.js:newScript`) — runs Monaco `new_indicator`/`new_strategy` action FIRST (the critical safety step that unbinds the editor), then setValue with template/user source, optionally POSTs to `/pine-facade/save/new` if `name` provided. Returns real `scriptIdPart` from pine-facade. Library type falls back to `new_indicator` action because TV doesn't register `new_library`. Old single-arg signature `{ type }` retained backward-compatible.
- **Fix 2 shipped** (`src/core/pine.js:save`) — detects bound state via title button + isSaveEnabled context key. Unbound path: requires `name`, POSTs directly to `/save/new`. Bound + dirty path: looks up the bound `scriptIdPart` by matching title against pine-facade list, invokes `vs.editor.ICodeEditor:1:save.script` via `editor._commandService.executeCommand`, then polls `/pine-facade/get/{id}/last` until source matches (line-endings normalized — TV stores `\r\n`). Bound + clean: no-op with explanation. Replaces the pre-Session-9 Ctrl+S dispatch that silently no-op'd on wrong focus.
- **Live integration proof** — direct page evaluation confirmed end-to-end roundtrip. Created two probe scripts (`tvmcp_fix1_e2e_*`) via the actual `/save/new` POST, returned real scriptIdPart from response, verified via `/get/{id}/last`. Source matches exactly (after line-ending normalization). Existing `ICC rv3 — Spec Viz` was NOT overwritten by any of the probes — the user actively edited it in another lane during my session (v1→v2 was a 7728→9271 char growth, both versions retrievable).
- 50/50 unit tests still pass (pin_registry + pine_analyze + pine_check). New tests deferred — see Decisions.
- Updated tool descriptions in `src/tools/pine.js` to surface the new signatures and document the safety guarantee.

### Decisions
- **Skipped writing new unit tests for Fix 1+2.** The orchestration logic is mostly `evaluate`/`evaluateAsync` calls into CDP — mocking that boundary would have been more scaffolding than test value. The live integration test against real pine-facade IS the proof point. If we hit regressions later, extract URL/body builders into pure helpers and test those.
- **Did not delete the probe scripts during this session.** Four leftover scripts (`tvmcp_probe_1780835557228`, `tvmcp_probe_b_1780836897242`, `tvmcp_fix1_e2e_1780839493669`, `tvmcp_fix1_e2e_1780839501332`) — all v1.0 stubs with marker names. Pre-approved as throwaway per HANDOFF; next session can delete after the post-restart live test confirms Fix 1+2 work end-to-end through the actual MCP tools.
- **`compile` and `smartCompile` still click the "Save and add to chart" button** which hits whatever slot the editor is currently bound to. Same data-loss risk if used on a bound editor with mutated source. Out of scope for Fix 1+2 (chart-attach vs pure save); revisit if Fix 4 pre-flight snapshot ships.

### Next
- **Carryover: post-restart MCP-level live test.** MCP server processes don't hot-reload, so the new `pine_new(name?, source?)` and `pine_save({name?, verify_timeout_ms?})` tool signatures aren't reachable through the running lanes — restart Claude Code to pick them up. Then: claim Pine on a fresh chart, `pine_new(type='indicator')` → verify editor goes to "Untitled script" + isSaveEnabled=true, `pine_set_source(<probe code>)`, `pine_save({name: 'tv-mcp-restart-test-<ts>'})` → verify returned scriptIdPart appears in `pine_list_scripts`, source matches via `pine_get_source`.
- **Cleanup pass:** delete the four probe scripts via TV UI (or implement a `pine_delete_script(scriptIdPart)` tool — the delete endpoint probably lives at `/pine-facade/delete/<id>` but wasn't captured this session).
- **Fix 4 still queued** (pre-flight snapshot hook) — deferred until Fix 1+2 prove stable across a few real Pine work sessions per the 2026-06-07 decision.

---

## Session 8: 2026-06-05 — Pine editor multi-instance claim (Fix 3 of 3 shipped)

### Done
- **Fix 3 — multi-instance Pine editor claim registry** (`2f4fbb6`) — bumped `~/.tv-mcp-registry.json` v1→v2 with backwards-compat v1 read; added singleton `pine_editor` slot alongside existing tab pins; new tools `pine_claim` / `pine_release` / `pine_claim_status`; `requirePineClaim()` gate on every write tool (`newScript`, `setSource`, `save`, `smartCompile`, `compile`); `TV_MCP_PINE_WRITE_UNGATED=1` escape hatch (off by default). Process-exit cleanup hooks into existing `releaseAllSync`. 12 new tests (claim/release/conflict-via-real-child-process/force-override/dead-PID-prune/v1-backward-compat). **34/34 pin_registry tests pass, 47/47 other unit tests pass.**
- Network probe for Fix 1 started but paused before triggering "New" — lane `tv-mcp-e` pinned to chart `YKaDEilf` (GC1! 1h), fetch+XHR interceptor installed in `window.__pineProbe.calls`. Both die on Claude Code restart, so next instance re-pins fresh.

### Decisions
- **Shipped Fix 3 before Fixes 1+2.** It's the cross-cutting safety net — even if 1+2 land buggy later, two instances can no longer silently clobber each other on shared TV cloud script slots. The pin_registry pattern already existed (Session 3 work), so Fix 3 was a clean extension with no new infra.
- **Chart-per-lane workflow isolation does NOT replace Fixes 1+2.** The 2026-06-05 incident was a single-instance bug (pine_new lies about creating + pine_save silently no-ops). Separate charts per workstream reduce blast radius from "any account script" to "whatever the tab last loaded," but don't fix the bug. User confirmed proceeding with Fix 1+2 next session.
- **Singleton (account-global) pine_editor claim, not per-tab.** TV cloud script slots are shared across the whole account, so coordination must be too. Spec Layer A.

### Next
- **Carryover: Fix 1 — `pine_new` actually creates a server-side slot.** Network probe gates this. First move next session: re-pin lane `e` to a fresh chart (or `YKaDEilf` again), reinstall the fetch interceptor (see `tests/recap` HTML for the snippet), trigger TV's "New script" menu programmatically, capture the pine-facade POST. Implementation pattern is in `SPEC-pine-safe-create.md` — POST to discovered endpoint → call `openScript()` to rebind editor → return real `scriptIdPart`.
- **Carryover: Fix 2 — reliable `save` with verification.** Monaco action `vs.editor.ICodeEditor:1:save.script` (proven in 2026-06-05 recovery) + pine-facade `/get/{id}/last` poll. Drop-in once Fix 1 ships.
- **After Fix 1+2 ship:** Claude Code restart + live integration test (two `pine_new` calls → +2 `pine_list_scripts` entries with `tv-mcp-probe-*` names; set source + save + verify roundtrip via pine-facade). Probe scripts named `tv-mcp-probe-<unix-ts>` are pre-approved as throwaway.
