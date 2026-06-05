# PROGRESS-tv-mcp — Archive

> Sessions archived from `PROGRESS-tv-mcp.md` to keep the live doc to the last 3 sessions.

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

