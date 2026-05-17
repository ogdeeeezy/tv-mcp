# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp`. Created 2026-05-11 by splitting MCP code out of `ogdeeeezy/tradibos` (now at `~/tradibos/`).

## Immediate next steps

1. **Phase 3 — DONE.** `tv_launch` in `src/tools/health.js` now delegates to `diag.chromeLaunch` with a `deprecation_notice` field. 29/29 unit tests pass. Old `core.launch` (TradingView Desktop / Electron path detection) is dead code now — can be deleted in a follow-up.
2. **Phase 4 — DONE.** `/Users/claudesplayground/.mcp.json` registers six unfiltered lanes `tv-mcp-a` through `tv-mcp-f`. Confirmed all six showing `✓ Connected` via `claude mcp list` (2026-05-14).
3. **Multi-lane pattern (replaces dual-filter plan).** Decision: do NOT preset filters per symbol. User wants flexibility for any ticker (RBLX, GC1!, anything). Pattern documented in `CLAUDE.md` under "Session opening protocol": agent asks user → `tab_registry` → `tab_picker` → `tab_pin <symbol|id>`. Each lane is an independent pin slot.
4. **Cross-instance pin registry — DONE (commit `15e5370`, 2026-05-14).** `~/.tv-mcp-registry.json` with lockfile, atomic writes, dead-PID pruning, and force-override. `tab_pin` returns `{conflict: true, owner: {...}}` when another live session owns the tab. New `tab_registry` tool exposes the claim map. 20/20 new unit tests pass, including real-subprocess conflict tests. 49/49 unit tests pass overall. **Still untested:** the actual two-session race against a live Chrome tab (would need two Claude sessions and Chrome up with CDP).
5. **Live-TV smoke test — DONE (2026-05-15).** Real cause of the launch failure was NOT singleton-attach — it was the Chrome 136+ default-profile block on `--remote-debugging-port`. Resolved via durable isolated profile at `~/Library/Application Support/tv-mcp-chrome` (signed in as withthechefboy@gmail.com, extensions arriving via Chrome Sync). Smoke test on `tv-mcp-a`: `chrome_launch` → `tab_picker` → `tab_pin title="GC1!"` → `chart_get_state` returned `symbol=COMEX:GC1!, resolution=240, 12 studies including W-Bottom v6b + ICC v3 Strategy` → `tab_unpin`. Setup and failure-mode dictionary documented in CLAUDE.md "Chrome setup" section.
6. **Documentation refresh — DONE (2026-05-15).** CLAUDE.md gained: "Chrome setup" section at top (before session protocol) covering the 136+ block, isolated profile location, failure-mode table, and what-not-to-debug list; "Known gotchas" section at bottom covering the symbol-regex parsing bug, MCP-server-no-hot-reload, chrome_launch 5s-wait false negatives, and pin-state vs registry-state distinction; Architecture diagram updated (Electron path removed — Phase 3 deprecation).
7. **README de-Electron finish — DONE (2026-05-17).** Deleted four Electron-era launch scripts. Rewrote README §"Launch TradingView with CDP" → chrome_launch primary path + manual chrome invocations as fallback. Rewrote §"Finding TradingView on Your System" → §"Verifying CDP is Reachable" (old TradingView.app paths were dead). 63/63 unit tests pass. Remaining Electron mentions in repo (AUDIT.md, CLAUDE.md Phase 3 note) are intentional historical context.

## What landed this session (2026-05-14)

- 1 commit: `15e5370` (cross-instance pin registry).
- 1 new tool registered: `tab_registry` (total now 69).
- New module `src/core/pin_registry.js`: file-backed claim/release/list, lockfile with stale-break, atomic temp-rename writes, dead-PID pruning, corruption tolerance, force-override with displaced-owner reporting.
- `src/connection.js`: `claimAndPin` / `releaseAndUnpin` + `exit`/`SIGINT`/`SIGTERM` cleanup hook so unclean shutdowns don't strand claims.
- 20 new unit tests (`tests/pin_registry.test.js`), wired into `npm test` / `test:unit` / `test:all` / new `test:registry` script.

## What landed last session

- 4 commits: `47ef05c` (audit migration), `15fe7c0` (Phase 1 connection layer), `fb522ec` (Phase 2 — 8 new tools), `c89efd5` (Phase 3 partial — 6 evaluate-undefined fixes + tab_close rewrite), `ea56f5c` (Phase 3+4: tv_launch deprecation stub + multi-lane wiring).
- 8 new tools registered: `tab_pin`, `tab_unpin`, `tab_picker`, `tab_close_by_id`, `chrome_launch`, `chrome_health`, `tv_reset`, `mcp_log_tail`.
- Connection layer: `pinnedTargetId` runtime state + `TV_MCP_TARGET_FILTER` env var (syntax: `symbol=X`, `title~Y`, `url~Z`, `id=exact`).
- 95+ existing unit/sanitization tests still pass.

## Known gotchas

- The `evaluate` alias trap in `src/core/chart.js` and `src/core/drawing.js`: module imports `evaluate as _evaluate`, so bare `evaluate(...)` calls only work after `const { evaluate } = _resolve(_deps);`. Same pattern in replay.js. If you add a new function, mimic the existing ones.
- `tab_close` and `tab_close_by_id` now both close via HTTP `/json/close/<id>`. If pin was on the closed tab, pin auto-clears.
- `mcp_log_tail` is opt-in — set `TV_MCP_LOG=1` (writes `~/.tv-mcp.log`) or `TV_MCP_LOG_FILE=/path` at server start.

## Hot files

- `src/connection.js` — pin/filter state, target selection, registry-aware claimAndPin/releaseAndUnpin, exit hooks
- `src/core/pin_registry.js` — file-backed cross-instance claim map
- `src/core/tab.js`, `src/tools/tab.js` — pin/picker/closeById/registry
- `src/core/diagnostics.js`, `src/tools/diagnostics.js` — chrome_*, tv_reset
- `src/core/mcp_log.js` — file logger
- `docs/AUDIT.md` — original scope/plan

## Related repos / locations

- `~/tradibos/` (strategy library, `ogdeeeezy/tradibos`)
- `~/tradingview-mcp.backup-2026-05-11/` (pre-split cold copy, safe to delete when confident)
- `~/tv-mcp.rsync-staging-2026-05-11/` (abandoned rsync staging, safe to delete)

## Open questions for user

- (RESOLVED 2026-05-13) Naming + filter strategy: six unfiltered lanes `tv-mcp-a..f`. User wants any-symbol flexibility, not preset filters. Old `tradingview` entry ripped out.
- (RESOLVED 2026-05-14) Cross-instance coordination: shipped via `pin_registry.js`. Tab-level locking with force-override and dead-PID pruning.
- (RESOLVED 2026-05-15) Live smoke test: done on tv-mcp-a against GC1!. Chrome 136+ default-profile block was the real blocker, now fixed via isolated profile.
- (RESOLVED 2026-05-15) Two-session-one-tab race: not a real workflow. User's pattern is one tab per lane (a, b, c, …), so the registry's value is dead-PID pruning + force-override for stuck sessions, not active contention. No live race test needed.
