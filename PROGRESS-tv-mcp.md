# PROGRESS-tv-mcp

> Sessions 1-2 archived → `docs/archive/archive-progress-tv-mcp.md`

---

## Session 6: 2026-05-18 — v1.0.0 released, README polish, CL position checked

### Done
- **v1.0.0 tagged + GitHub release published** — annotated tag on `9e26de3`, release at https://github.com/ogdeeeezy/tv-mcp/releases/tag/v1.0.0. Notes cover: one-command onboarding (`npm run setup` / `tv setup`), issue #1 closed end-to-end, 80/80 tests, CI matrix `{ubuntu, macos, windows} × node {18, 20, 22}`, six-lane default, no-npm rationale.
- **README CLI block polished** (`9e26de3`) — `tv setup` now leads both the Quick Examples and the All Commands list. Added a sentence explaining what it does (isolated profile + CDP launch + config snippet). Was a S4/S5 carry-over.
- **Schwab CL position sanity-checked** on H2 — log shows position alive (entry $95.64, stop $85.24, trail still inactive), cron running on schedule. Latest 4h close $102.43 → position is **+$6.79/contract unrealized**, not in drawdown. The S5 note about `net_profit` dropping $20,532 → $18,522 was backtest-range MTM drift on the still-open trade, not a live-position issue. No action needed.
- Token refresh blip 6:15-7:15 AM ET 2026-05-18 (recovered by 8:15) — single transient, no follow-up needed unless it recurs.

### Decisions
- **Release notes published to GitHub, not as a separate CHANGELOG.md.** Single-source-of-truth at the GitHub release page; if a CHANGELOG ever matters for offline browsing, generate it from `gh release list --json` later.

### Next
- All shipping-readiness work is done. No carry-overs.
- Next tv-mcp session opens only on real demand: a friend hits a bug, an upstream change to vendor in, or a new feature ask.
- Side-channel: schwab CL position remains open and profitable — no tv-mcp dependency.

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
- **Phase A — polish for sharing** (`0641ac9`) — package.json: fixed description (no more "TradingView Desktop"), added repository/homepage/bugs/keywords/license/files/engines/prepublishOnly. LICENSE: added fork copyright (ogdeeeezy 2026) alongside upstream. README: leads with `npm run setup`, six-lane MCP config in headline, manual flow collapsed into `<details>`, CI/Node/License badges at top, all upstream repo URLs fixed to ogdeeeezy/tv-mcp. New `.github/workflows/ci.yml`: matrix on {ubuntu, macos, windows} × node {18, 20, 22} running `test:unit`.
- **Phase B — `tv setup` command** (`0641ac9`) — `src/cli/commands/setup.js`: one-shot onboarding. Picks OS-appropriate Chrome profile path, creates it, calls `chromeLaunch` idempotently, prints six-lane `mcp_config` block ready to paste. Supports `--lanes 1-26`, `--user-data-dir`, `--port`. 5 new unit tests in `tests/setup.test.js`. Idempotency verified against real isolated profile + already-running Chrome.
- **Package rename** (`f42345c`) — `name: "tv-mcp"` (matches GitHub), `version: "1.0.0"` (clean milestone).
- **npm publish abandoned** — hit 2FA wall, generated/used granular access token path, then user pushed back on whether npm was needed at all. Decided no: public clone-from-GitHub already covers the install story end-to-end (`git clone → npm install → npm run setup`). Token revoked.
- 68/68 unit tests pass. `npm pack --dry-run` clean (74 kB / 60 files) — package is publish-ready if you ever change your mind.

### Decisions
- **Skipped npm publish.** Friends install via `git clone`. The `tv setup` command does all the heavy lifting (Chrome profile + launch + config snippet) so a global `tv` binary on PATH wasn't worth the npm overhead (token rotation, semver discipline, 2FA setup). Kept `name: tv-mcp` + `version: 1.0.0` in package.json anyway — they match reality whether we publish or not.
- **Six lanes is the default** for `tv setup` config output (not one). Reasoning: power-user pattern (parallel charts) is also the right newcomer default — extra lanes are idle until used, no downside. `--lanes 1` for users who only want one.
- **CI runs `test:unit`, not `test`.** Live-CDP e2e tests need a real Chrome + TV tab and aren't reproducible in CI. Unit + setup tests cover the parts that should never regress.

### Next
- (Optional, ceremonial) `git tag v1.0.0 && gh release create v1.0.0` to mark this as the first publicly-shareable cut.
- (Maybe) update README's "CLI" section to reflect that `tv setup` exists — it's listed in the help output but the CLI examples block still leads with `tv status` / `tv quote`.
- Tradibos context switch — read `STRATEGIES-tradibos.md` on H2 (`ssh root@100.123.131.45`, `/root/tradibos/`).

---

## Session 3: 2026-05-17 — Phase 3 cleanup finish

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
