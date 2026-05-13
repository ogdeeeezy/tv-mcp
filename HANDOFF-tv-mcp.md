# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp`. Created 2026-05-11 by splitting MCP code out of `ogdeeeezy/tradibos` (now at `~/tradibos/`).

## Immediate next steps

1. **Phase 3 — DONE.** `tv_launch` in `src/tools/health.js` now delegates to `diag.chromeLaunch` with a `deprecation_notice` field. 29/29 unit tests pass. Old `core.launch` (TradingView Desktop / Electron path detection) is dead code now — can be deleted in a follow-up.
2. **Phase 4 — wire-in DONE (pending restart).** `/Users/claudesplayground/.mcp.json` updated: removed dead `tradingview` entry, added six unfiltered lanes `tv-mcp-a` through `tv-mcp-f`. Each lane is identical, idle pins to nothing. **Takes effect on next Claude Code session restart** — the running session still sees the old registration.
3. **Multi-lane pattern (replaces dual-filter plan).** Decision: do NOT preset filters per symbol. User wants flexibility for any ticker (RBLX, GC1!, anything). Pattern documented in `CLAUDE.md` under "Session opening protocol": agent asks user → `tab_picker` → `tab_pin <symbol|id>`. Each lane is an independent pin slot.
4. **Still TODO — live-TV smoke test.** Requires restart + Chrome+TV running with CDP. Exercise: `chrome_launch` → `tab_picker` → `tab_pin symbol=<whatever user picks>` → `chart_get_state` → `tab_unpin`. Audit's whole point (multi-tab non-collision) is still unvalidated against a real chart.

## What landed this session

- 4 commits: `47ef05c` (audit migration), `15fe7c0` (Phase 1 connection layer), `fb522ec` (Phase 2 — 8 new tools), `c89efd5` (Phase 3 partial — 6 evaluate-undefined fixes + tab_close rewrite).
- 8 new tools registered: `tab_pin`, `tab_unpin`, `tab_picker`, `tab_close_by_id`, `chrome_launch`, `chrome_health`, `tv_reset`, `mcp_log_tail`.
- Connection layer: `pinnedTargetId` runtime state + `TV_MCP_TARGET_FILTER` env var (syntax: `symbol=X`, `title~Y`, `url~Z`, `id=exact`).
- 95+ existing unit/sanitization tests still pass.

## Known gotchas

- The `evaluate` alias trap in `src/core/chart.js` and `src/core/drawing.js`: module imports `evaluate as _evaluate`, so bare `evaluate(...)` calls only work after `const { evaluate } = _resolve(_deps);`. Same pattern in replay.js. If you add a new function, mimic the existing ones.
- `tab_close` and `tab_close_by_id` now both close via HTTP `/json/close/<id>`. If pin was on the closed tab, pin auto-clears.
- `mcp_log_tail` is opt-in — set `TV_MCP_LOG=1` (writes `~/.tv-mcp.log`) or `TV_MCP_LOG_FILE=/path` at server start.

## Hot files

- `src/connection.js` — pin/filter state, target selection
- `src/core/tab.js`, `src/tools/tab.js` — pin/picker/closeById
- `src/core/diagnostics.js`, `src/tools/diagnostics.js` — chrome_*, tv_reset
- `src/core/mcp_log.js` — file logger
- `docs/AUDIT.md` — original scope/plan

## Related repos / locations

- `~/tradibos/` (strategy library, `ogdeeeezy/tradibos`)
- `~/tradingview-mcp.backup-2026-05-11/` (pre-split cold copy, safe to delete when confident)
- `~/tv-mcp.rsync-staging-2026-05-11/` (abandoned rsync staging, safe to delete)

## Open questions for user

- (RESOLVED 2026-05-13) Naming + filter strategy: six unfiltered lanes `tv-mcp-a..f`. User wants any-symbol flexibility, not preset filters. Old `tradingview` entry ripped out.
- Live smoke test still pending — needs Claude Code restart + Chrome with CDP + user-selected symbol.
