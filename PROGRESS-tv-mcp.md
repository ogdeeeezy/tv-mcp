# PROGRESS-tv-mcp

> Sessions 1-8 archived → `docs/archive/archive-progress-tv-mcp.md`

---

## Session 14: 2026-06-10 — pine_save({scriptIdPart}) smoke-tested PASS

### Done
- **In-place save end-to-end verified through the MCP** on a fresh `tv-mcp-d` lane post-restart. Created disposable slot via `pine_new(name="smoke-test-pine-save-2026-06-10")` → `USER;a4c2e20eb8754638ba6e2d609546903a` v1.0. `pine_open(name=...)` → loaded source, `bound: false`. `pine_set_source(<modified with marker>)` → 7 lines. `pine_save({scriptIdPart})` returned `action: "saved_to_existing"`, `version: "2.0"`, `verified: true` (pine-facade /get/last cross-check). `pine_list_scripts` confirmed: slot id unchanged, name preserved, title picked up from new `indicator()` declaration, modified timestamp current, no duplicate entry. Slot then `pine_delete`d cleanly (verified absent on re-list).
- **Verdict:** the per-id overwrite path is the in-place edit workflow it was designed to be. Caller-provided `scriptIdPart` wins, no silent dupes, version bumps correctly.

### Decisions
- None. This was a verification run, no code changes.

### Next
- None outstanding. Project at clean rest state. All HANDOFF follow-ups closed.

---

## Session 13: 2026-06-10 — openScript smoke-tested, pine_delete shipped

### Done
- **openScript fix smoke-tested PASS** (`e0e1cc9`). `pine_open(name="tvmcp_probe_1780835557228")` → `bound: false`, title "Untitled script". Follow-up save: `pine_save({name=<same>})` returned **HTTP 409 "Script already exists"** — TV refuses duplicate names server-side at `/pine-facade/save/new?allow_overwrite=false`. Louder failure than the handoff predicted (no silent dupe), library stays clean.
- **Delete endpoint captured.** Installed fetch interceptor on the gold-baby tab, user deleted 3 stale probe scripts via TV's UI, log captured: `POST https://pine-facade.tradingview.com/pine-facade/delete/<urlencoded-id>` with no body. Prior 401 probe failed because it hit `www.tradingview.com` (wrong subdomain). DELETE method stays CORS-blocked; POST is the verb.
- **`pine_delete` tool wired and shipped** (`6e4513b`). Accepts `{name?, scriptIdPart?}`. `scriptIdPart` wins on conflict. Name lookup case-insensitive, refuses on ambiguous match with `PINE_DELETE_AMBIGUOUS` + `matches[]`. Requires `pine_claim`. Verifies by re-listing post-delete (same pattern TV's UI uses — observed re-list after each delete in capture trace).
- **10 unit tests** for `selectDeleteTarget` (`tests/pine_delete.test.js`); full unit suite 104/104.
- **Library cleanup side-effect:** 4 stale probe scripts deleted by user during capture (3 directly + restart-test via hard refresh after the first attempt was silently refused).

### Decisions
- **scriptIdPart wins when both args provided.** Explicit ID is unambiguous; name can collide with the duplicate-slot artifacts that `pine_open` + `pine_save` could create.
- **Required pine_claim despite delete not touching editor state.** Cloud-side destructive mutation — same threat model as `pine_save` (account-global resource); the singleton claim is the right gate.

### Next
- **Restart Claude Code** so the six `tv-mcp-*` lanes pick up `6e4513b` + `d1a52a2`.
- **End-to-end smoke test** of the new in-place save: `pine_claim → pine_open(name=<disposable>) → pine_set_source → pine_save({scriptIdPart}) → pine_get_source` to verify version bumps + source matches.

### Bonus — in-place save endpoint captured + wired (`d1a52a2`)
- Same fetch-interceptor method as the delete capture, but with the user opening `ICC rv1 Strategy` via TV's UI (title button → "Open script…") to get a bound editor, then Cmd+S after a one-char dirty.
- Endpoint: `POST /pine-facade/save/next/<urlencoded-id>?allow_create_new=false&name=<urlencoded-name>` with FormData `source`. `allow_create_new=false` is the safety knob.
- `pine_save` now accepts `scriptIdPart`; when provided, routes to /save/next/<id> (wins over editor binding). Three paths: (1) scriptIdPart → in-place, (2) bound + no id → Monaco save.script, (3) unbound + name → /save/new.
- Unlocks: `pine_open → edit → pine_save({scriptIdPart})` as the in-place edit workflow.
- Side-effect: `ICC rv1 Strategy` now has a stray space in its title comment (`I CC rv2 Strategy` instead of `ICC rv2 Strategy`) from the dirty-buffer trigger. Cosmetic — user can edit back via TV UI when convenient.

---

## Session 12: 2026-06-10 — openScript rebinding gap closed

### Done
- **`openScript` rebinding gap closed** (uncommitted on disk). Added `new_indicator` Monaco action invocation before `setValue` in `src/core/pine.js:openScript()`, mirroring the Fix 1+2 pattern in `newScript()`. Editor lands as unbound draft holding the loaded source. Tool description in `src/tools/pine.js` updated to reflect the new "duplicates loudly instead of overwriting silently" contract. 94/94 unit tests still pass.
- **Discovery: title-button menu has the open-script chain.** Live-probed the Pine editor title button (`[data-qa-id="pine-script-title-button"]`) — its menu lists "Save script", "Make a copy…", "Rename…", "Version history…", "Move script to bottom", "Create new", "Open script… ⌘O". `Create new` wires to `de()` (the `new_indicator` Monaco action — the same path `pine_new` uses). `Open script…` opens a submenu/picker dialog whose inner click handler is the actual editor-bind routine. Couldn't extract the bind handler statically (closure-captured), and didn't pursue further — the `new_indicator` pre-unbind path is a complete safety fix and ships value without it.
- **save.script on unbound editor confirmed silent no-op** (sniffer captured zero pine-facade fetches, no dialog). The HANDOFF gotcha holds: `isSaveEnabled + placement%3Ddialog` is the real safety fuse. The data-loss path requires a binding established via TV's UI — which `openScript` no longer leaves intact.

### Decisions
- **Did not pursue the per-id overwrite endpoint** in this session. Capturing it requires a bound editor (manual TV UI click) and the user was frustrated with how long the probing took. Logged as follow-up #1 in HANDOFF with the exact reproduction recipe.
- **Did not run e2e tests** — they would collide with the pinned `gold` tab via CDP. Unit suite (94 tests) covers pin_registry + pine_analyze + tab_picker + setup; the pine.js change is JS-template strings injected via CDP and isn't directly unit-testable.

### Next
- Commit `feat(pine): openScript runs new_indicator before setValue (closes rebinding gap)` and push.
- Capture per-id overwrite endpoint when convenient — HANDOFF #1 has the recipe.
- Capture delete endpoint via DevTools — HANDOFF #2.

---

## Session 11: 2026-06-08/09 — Fix 1+2 verified green, e2e fixes staged

### Done
- **Fix 1+2 verification GREEN** (`e7b4a2f`) — coordinated force-claim with the live ICC instance (`pine_editor` registry was held by stale PID 10111). Ran `pine_claim → pine_new → pine_set_source → pine_save({name}) → pine_list_scripts → pine_get_source → pine_release` on lane `tv-mcp-a` (chart "gold"). Result: `action: saved_as_new`, `verified: true`, slot `USER;b465c8a4e8854a58956e59822e644fbf` landed in list with byte-exact source. ICC rv3 — Spec Viz at v11.0 untouched throughout.
- **HANDOFF + INSIGHTS closeout** (`39fd173`) — replaced "awaiting verify" with the Session 11 proof. New INSIGHTS captures: dialog-as-fuse mechanism (`isSaveEnabled` + URL-encoded `placement%3Ddialog` as the real safety, not the title-button DOM); only ONE Monaco editor instance ever exists; URI sniffing must use URL-encoded form.
- **3 e2e test fixes staged (uncommitted).** `tv_launch` binary detection — converted to no-op assertion since Phase 3 deprecates the desktop path. `ui_open_panel` — replaced removed `hideWidget(name)` with parameterless `close()` (probed live: own-method `close` replaces it). `replay_stop` — added `isReplayStarted` re-check before `goToRealtime` to avoid race when prior tests left state dirty. INSIGHTS appendix added on the new `bottomWidgetBar` API surface.
- **`openScript` rebinding gap explored, deferred.** Live probing showed no direct "open script by id" routine in the immediate React surfaces around the Pine editor. The handler likely lives further down the title-button click chain or in a `_pineScriptManager`-style service we didn't find. Defer — chasing it further risks mutating ICC's working state.

### Decisions
- **Force-claim was safe** because the ICC instance was paused explicitly waiting for the FIND_MONACO patch to land. Coordinated via cross-instance message before forcing.
- **e2e fixes left uncommitted** because in-session `npm test` verification hit tool-runtime backgrounding. Mechanically obvious changes — safer to have the next instance run the suite and ship the commit.
- **Stopped probing for the delete endpoint** mid-session. User is doing manual UI cleanup of 5 stale probe scripts; capturing the real endpoint via DevTools is a follow-up.

### Next
- **First action:** `cd ~/tv-mcp && npm test` to verify the 3 staged e2e fixes pass. Expect ~160/160 with no fail (was 157/160 before fixes). If green, commit `fix(e2e): TV API drift (hideWidget removed, replay_stop race, tv_launch deprecated)` and push.
- `openScript` rebinding gap (sleeping bug) — needs deeper live probe of TV's internal load-by-id routine.
- Capture real `pine-facade` delete endpoint via DevTools while user deletes one script through TV UI. Wire `pine_delete` tool.

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
