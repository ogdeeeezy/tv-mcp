# PROGRESS-tv-mcp — Archive

> Sessions archived from `PROGRESS-tv-mcp.md` to keep the live doc to the last 3 sessions.

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

---

## Session 7: 2026-05-19 — v1.0.1 polish & cleanup

### Done
- **README MCP-config example surfaced** — six-lane JSON block now visible in the main Quick Start flow instead of hidden behind `<details>`. A separate `<details>` collapsible documents the single-server variant for users who only want one lane. Someone reading the README in isolation now sees the correct config shape without running `tv setup`.
- **Stale "Symbol regex misses titles without parentheses" gotcha removed from `CLAUDE.md`** — the underlying bug was already fixed in `55a55e6` (parser widened to handle both parenthesized and leading-symbol formats, 14 tests covering both shapes + null-return cases). Documentation drift, not new code.
- **Pre-split backups deleted** — `~/tradingview-mcp.backup-2026-05-11/` (145M) and `~/tv-mcp.rsync-staging-2026-05-11/` (6.7M). `diff -rq` confirmed all unique content is either pre-split tradibos material (lives in `~/tradibos/` now) or deprecated Electron launch scripts (Phase 3 removed). `MCP-AUDIT.md` already merged in as `docs/AUDIT.md` (byte-identical). ~152M reclaimed.
- **v1.0.1 tagged + GitHub release published** covering "polish & cleanup."
- 80/80 unit tests still pass.

### Decisions
- **No new tests for `parseSymbolFromTitle`** — the three categories the task asked for (leading-symbol, parenthesized, null-return) are already covered with 9 cases across the existing suite. Adding redundant tests would just be noise.

### Next
- No carry-overs. v1.0.1 is the end of the polish pass.
- Next tv-mcp session opens only on real demand: a friend hits a bug, an upstream change to vendor in, or a new feature ask.

---

## Session 6: 2026-05-18 — v1.0.0 released, README polish, CL position checked

### Done
- **v1.0.0 tagged + GitHub release published** — annotated tag on `9e26de3`, release at https://github.com/ogdeeeezy/tv-mcp/releases/tag/v1.0.0. Notes cover: one-command onboarding (`npm run setup` / `tv setup`), issue #1 closed end-to-end, 80/80 tests, CI matrix `{ubuntu, macos, windows} × node {18, 20, 22}`, six-lane default, no-npm rationale.
- **README CLI block polished** (`9e26de3`) — `tv setup` now leads both the Quick Examples and the All Commands list. Added a sentence explaining what it does (isolated profile + CDP launch + config snippet). Was a S4/S5 carry-over.
- **Schwab CL position sanity-checked** on H2 — log shows position alive (entry $95.64, stop $85.24, trail still inactive), cron running on schedule. Latest 4h close $102.43 → position is **+$6.79/contract unrealized**, not in drawdown.
- Token refresh blip 6:15-7:15 AM ET 2026-05-18 (recovered by 8:15) — single transient, no follow-up needed unless it recurs.

### Decisions
- **Release notes published to GitHub, not as a separate CHANGELOG.md.** Single-source-of-truth at the GitHub release page; if a CHANGELOG ever matters for offline browsing, generate it from `gh release list --json` later.

### Next
- All shipping-readiness work is done. No carry-overs.
- Next tv-mcp session opens only on real demand.

---

## Session 2: 2026-05-15 — Registry, live smoke test, polish

### Done
- **Cross-instance pin registry** (`15e5370`) — file-backed claim map at `~/.tv-mcp-registry.json` with lockfile, atomic writes, dead-PID pruning, force-override. New `tab_registry` tool. 20 unit tests including real-subprocess conflict races.
- **Documentation pass** (`f0b2bd1`, `94194f9`) — CLAUDE.md gained "Chrome setup" section (Chrome 136+ default-profile block + failure-mode dictionary + isolated profile location) and "Known gotchas" (symbol regex, MCP-no-hot-reload, 5s-wait false negatives, pin-state-vs-registry-state). HANDOFF updated.
- **Polish** (`55a55e6`) — `parseSymbolFromTitle` exported and now handles both old `(GC1!),` and new `GC1! 4,557.2 ▼` title formats; old `core.launch` (Electron path detection) removed; CLI `tv launch` re-pointed to `diag.chromeLaunch` with `--user-data-dir` support; README de-Electron'd. 14 new parser tests.
- **Live smoke test on GC1!** — `tv-mcp-a`: chrome_launch (isolated profile) → tab_picker → tab_pin title=GC1! → chart_get_state returned `COMEX:GC1!, resolution=240, 12 studies incl. W-Bottom v6b + ICC v3 Strategy` → tab_unpin. Audit's headline multi-tab non-collision scenario validated against a real chart.
- **63/63 unit tests pass.** Live e2e still skipped (requires CDP + opened TV tabs).

### Decisions
- Chrome 136+ workaround: durable isolated profile at `~/Library/Application Support/tv-mcp-chrome` signed in as `withthechefboy@gmail.com`. Chrome Sync brings extensions; TV login is local-only. Two-Chrome side-by-side pattern (default for browsing, isolated for MCP).
- Registry is **tab-scoped, not lane-scoped** — six lanes × N sessions all coordinate on a shared targetId map. Force-override returns the displaced owner for telemetry.
- Symbol regex extracted to a pure, tested function rather than widened-in-place. Easier to add new TradingView title formats as they appear.

### Next
- (Optional) live two-session registry race against a real Chrome tab — code is unit-tested via subprocess workers but the actual multi-Claude-session scenario has never run.
- Tradibos strategy work — context switched to `~/tradibos/` on H2 (`ssh root@100.123.131.45`). Read STRATEGIES-tradibos.md before any new strategy or deploy decision.
- README is mostly de-Electron'd but mentions of `tv launch` scripts (scripts/launch_tv_debug_mac.sh etc.) may now point at stale shell scripts — confirm those still work or flag stale.

---

## Session 1: 2026-05-11 — Fork + Phase 1/2/3-partial

### Done
- **Repo split from tradibos** (`1a8d49a` in tradibos) — extracted MCP server code to fresh fork at `ogdeeeezy/tv-mcp`. Tradibos library stays at `ogdeeeezy/tradibos`. Pre-split snapshot tagged `pre-split-2026-05-11`. Backups: `~/tradingview-mcp.backup-2026-05-11/`.
- **Migrated in-flight MCP work** (`47ef05c`) — audit doc + tv-reset skill.
- **Phase 1 — tab-pinning connection layer** (`15fe7c0`) — runtime `pinnedTargetId` + `TV_MCP_TARGET_FILTER` env var (symbol/title/url/id × =/~). findChartTarget honors pin > filter > default. 95/95 existing tests still pass.
- **Phase 2 — 8 new tools** (`fb522ec`) — `tab_pin`, `tab_unpin`, `tab_picker`, `tab_close_by_id`, `chrome_launch`, `chrome_health`, `tv_reset`, `mcp_log_tail`. New file logger module.
- **Phase 3 partial — 6 bug fixes + tab_close rewrite** (`c89efd5`) — scoped `evaluate` in chart.js (scrollToDate, getVisibleRange, symbolInfo) and drawing.js (listDrawings, getProperties, removeOne, clearAll). tab_close now uses CDP `/json/close` instead of broken Electron Cmd+W path.

### Decisions
- Fork-and-extend over rewrite (per audit). 74 inherited tools untouched.
- `tab_close` delegates to `tab_close_by_id` rather than maintaining two impls.
- File logger is opt-in (`TV_MCP_LOG=1`) — no log file by default so we don't surprise users with disk writes.

### Next
- Stub `tv_launch` to delegate to `chrome_launch` (finishes Phase 3).
- Phase 4: register in `~/.claude/settings.json`, document dual-registration pattern.
- Live-TV smoke test (audit's headline scenario: pin-by-symbol for two parallel sessions).
- Optional: rebase against upstream periodically to inherit their fixes.

---

## Session 3: 2026-05-17 — Phase 3 cleanup finish
*(archived 2026-05-18 after S6, commit pending)*

### Done
- **README de-Electron pass (final)** — deleted four Electron-era launch scripts (`launch_tv_debug_{mac,linux}.sh`, `launch_tv_debug.{bat,vbs}`). Rewrote README §"Launch TradingView with CDP" → §"Launch Chrome with CDP" with chrome_launch as primary path and explicit manual chrome invocations for mac/linux/windows. Rewrote §"Finding TradingView on Your System" → §"Verifying CDP is Reachable" (the old section listed `TradingView.app` paths, meaningless now that the Electron path is dead). `tv_launch` mention kept since it still works as a deprecation stub.
- **`test:registry` npm script scope fix** — script was running `pin_registry.test.js` + `tab_picker.test.js` due to an over-eager regex during the polish commit. Trimmed to only `pin_registry.test.js` so the name matches the scope. 20/20 registry tests still pass; tab_picker tests covered by `test`, `test:unit`, `test:all`, `test:verbose`.
- **Resolved leftover open question** — two-session-one-tab race in HANDOFF: not a real workflow (user runs one tab per lane), no live test needed. Registry's value is dead-PID pruning + force-override, already unit-tested.
- 63/63 unit tests pass. Only lingering Electron mentions in repo are AUDIT.md:209 (historical) and CLAUDE.md:243 (the explicit Phase 3 deprecation note) — both intentional.

### Decisions
- README launch flow now leads with the MCP tool (`chrome_launch`) rather than shell scripts. Manual chrome invocations included as a fallback for users who haven't wired up the MCP yet, but no longer the headline path.
- Did not touch README's MCP-config example (still shows single `"tradingview"` server). The six-lane `tv-mcp-a..f` pattern lives in CLAUDE.md and the user's `~/.mcp.json`. Open question whether README should advertise multi-lane or keep the simple single-server example — left for next session.

### Next
- Tradibos context switch — read `STRATEGIES-tradibos.md` on H2 (`ssh root@100.123.131.45`, `/root/tradibos/`). Decide what to do there.
- (Maybe) update README MCP-config example to show multi-lane registration.

---

## Session 5: 2026-05-18 — tv-mcp #1 verified live + deferred unit tests landed

### Done
- **Unit tests for `IS_STRATEGY_JS` + `SCRAPE_STRATEGY_TESTER_JS`** (`ba99a55`) — 12 cases via `vm.runInNewContext` with mock document/sources. Covers all six strategy-data hooks (`reportData / performance / ordersData / tradesData / equityData / _orders`), `is_price_study` gating, throwing `metaInfo`, DOM scrape with U+2212 minus and comma-grouped numbers, alternate label spellings. Wired into `test` / `test:unit` / `test:all` / `test:verbose`. Suite now **80/80** (was 68/68).
- **Fix from `fd2ded8` verified live** on tv-mcp-b against `NYMEX:CL1!` 4h. `data_get_strategy_results` returned `source: "dom_scrape"`, 5 populated metrics (net_profit 18,522.5, max_drawdown 32,622.5, total_trades 167, percent_profitable 44.31, profit_factor 1.072). Note field reads "internal_api returned empty metrics; scraped Strategy Tester DOM" — exactly the new fallback path firing on v6a charts. Issue #1 fully closed end-to-end.

### Decisions
- **vm-context object identity gotcha** — `assert.deepEqual({}, vmCtx.emptyMetrics)` fails strict-equality even when both are empty, because the vm-context `{}` has a cross-realm prototype. Switched the empty-metrics test to `Object.keys(...).length === 0`. Worth remembering for any future vm-based test.

### Next
- (Optional, ceremonial) `git tag v1.0.0 && gh release create v1.0.0` — still open from S4.
- (Maybe) README "CLI" examples block still leads with `tv status` / `tv quote`, not `tv setup` — also S4 carry-over.
- (Side-channel) CL backtest `net_profit` dropped $20,532.50 → $18,522.50 between S40 (schwab repo) and now. CL guard prevents new entries; the still-open position (entry $95.64, stop $85.24) is taking unrealized drawdown. Worth a glance at H2 cron logs next schwab session.

---

## Session 4: 2026-05-18 — Prod-ready packaging (Phase A+B) and npm decision

### Done
- **Phase A — polish for sharing** (`0641ac9`) — package.json: fixed description, added repository/homepage/bugs/keywords/license/files/engines/prepublishOnly. LICENSE: added fork copyright (ogdeeeezy 2026). README: leads with `npm run setup`, six-lane MCP config in headline, manual flow collapsed into `<details>`, CI/Node/License badges at top. New `.github/workflows/ci.yml`: matrix on {ubuntu, macos, windows} × node {18, 20, 22} running `test:unit`.
- **Phase B — `tv setup` command** (`0641ac9`) — `src/cli/commands/setup.js`: one-shot onboarding. Picks OS-appropriate Chrome profile path, calls `chromeLaunch` idempotently, prints six-lane `mcp_config` block. Supports `--lanes 1-26`, `--user-data-dir`, `--port`. 5 new unit tests in `tests/setup.test.js`. Idempotency verified.
- **Package rename** (`f42345c`) — `name: "tv-mcp"`, `version: "1.0.0"`.
- **npm publish abandoned** — hit 2FA wall, then user pushed back on whether npm was needed at all. Decided no: public clone-from-GitHub already covers install end-to-end. Token revoked.
- 68/68 unit tests pass. `npm pack --dry-run` clean (74 kB / 60 files).

### Decisions
- **Skipped npm publish.** Friends install via `git clone`. The `tv setup` command does all the heavy lifting so a global `tv` binary on PATH wasn't worth the npm overhead.
- **Six lanes is the default** for `tv setup` config output (not one). Extra lanes are idle until used.
- **CI runs `test:unit`, not `test`.** Live-CDP e2e tests need a real Chrome + TV tab and aren't reproducible in CI.

### Next
- (Optional) Tag v1.0.0 + GH release.
- (Maybe) update README CLI section.
- Tradibos context switch.


---

## Session 8: 2026-06-05 — Pine editor multi-instance claim (Fix 3 of 3 shipped)

### Done
- **Fix 3 — multi-instance Pine editor claim registry** (`2f4fbb6`) — bumped `~/.tv-mcp-registry.json` v1→v2 with backwards-compat v1 read; added singleton `pine_editor` slot alongside existing tab pins; new tools `pine_claim` / `pine_release` / `pine_claim_status`; `requirePineClaim()` gate on every write tool (`newScript`, `setSource`, `save`, `smartCompile`, `compile`); `TV_MCP_PINE_WRITE_UNGATED=1` escape hatch (off by default). Process-exit cleanup hooks into existing `releaseAllSync`. 12 new tests (claim/release/conflict-via-real-child-process/force-override/dead-PID-prune/v1-backward-compat). **34/34 pin_registry tests pass, 47/47 other unit tests pass.**
- Network probe for Fix 1 started but paused before triggering "New" — lane `tv-mcp-e` pinned to chart `YKaDEilf` (GC1! 1h), fetch+XHR interceptor installed in `window.__pineProbe.calls`. Both die on Claude Code restart, so next instance re-pins fresh.

### Decisions
- **Shipped Fix 3 before Fixes 1+2.** It's the cross-cutting safety net — even if 1+2 land buggy later, two instances can no longer silently clobber each other on shared TV cloud script slots. The pin_registry pattern already existed (Session 3 work), so Fix 3 was a clean extension with no new infra.
- **Chart-per-lane workflow isolation does NOT replace Fixes 1+2.** The 2026-06-05 incident was a single-instance bug (pine_new lies about creating + pine_save silently no-ops). Separate charts per workstream reduce blast radius from "any account script" to "whatever the tab last loaded," but don't fix the bug.
- **Singleton (account-global) pine_editor claim, not per-tab.** TV cloud script slots are shared across the whole account, so coordination must be too. Spec Layer A.

### Next (carryover)
- Fix 1 — `pine_new` actually creates a server-side slot.
- Fix 2 — reliable `save` with verification.
- After Fix 1+2 ship: Claude Code restart + live integration test.
