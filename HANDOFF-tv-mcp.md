# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp`. Created 2026-05-11 by splitting MCP code out of `ogdeeeezy/tradibos` (now at `~/tradibos/`).

## Immediate next steps

1. **Phase 3 — DONE.** `tv_launch` in `src/tools/health.js` now delegates to `diag.chromeLaunch` with a `deprecation_notice` field. 29/29 unit tests pass. Old `core.launch` (TradingView Desktop / Electron path detection) is dead code now — can be deleted in a follow-up.
2. **Phase 4 — DONE.** `/Users/claudesplayground/.mcp.json` registers six unfiltered lanes `tv-mcp-a` through `tv-mcp-f`. Confirmed all six showing `✓ Connected` via `claude mcp list` (2026-05-14).
3. **Multi-lane pattern (replaces dual-filter plan).** Decision: do NOT preset filters per symbol. User wants flexibility for any ticker (RBLX, GC1!, anything). Pattern documented in `CLAUDE.md` under "Session opening protocol": agent asks user → `tab_registry` → `tab_picker` → `tab_pin <symbol|id>`. Each lane is an independent pin slot.
4. **Cross-instance pin registry — DONE (commit `15e5370`, 2026-05-14).** `~/.tv-mcp-registry.json` with lockfile, atomic writes, dead-PID pruning, and force-override. `tab_pin` returns `{conflict: true, owner: {...}}` when another live session owns the tab. New `tab_registry` tool exposes the claim map. 20/20 new unit tests pass, including real-subprocess conflict tests. 49/49 unit tests pass overall. **Still untested:** the actual two-session race against a live Chrome tab (would need two Claude sessions and Chrome up with CDP).
5. **Still TODO — live-TV smoke test.** Requires Chrome relaunched with `--remote-debugging-port=9222` (currently the user's main Chrome PID 589 has no debug flag, so `chrome_launch` cannot bind — singleton attach). Exercise: `chrome_launch kill_existing=true` (destructive — closes current tabs) OR user-restarts Chrome manually → `tab_picker` → `tab_pin symbol=GC1!` → `chart_get_state` → `tab_unpin`. Audit's whole point (multi-tab non-collision) is still unvalidated against a real chart.

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
- Live smoke test still pending — needs Chrome relaunched with `--remote-debugging-port=9222`. User's main Chrome (PID 589) currently has no debug flag, so `chrome_launch` singleton-attaches and never binds the port. Resolution path: `chrome_launch kill_existing=true` (destructive) or user quits Chrome and we relaunch clean.
