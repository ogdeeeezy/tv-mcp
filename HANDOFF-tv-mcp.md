# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp`. Created 2026-05-11 by splitting MCP code out of `ogdeeeezy/tradibos` (now at `~/tradibos/`).

## Immediate next steps

1. **Finish Phase 3** — only one item left: stub `tv_launch` in `src/tools/health.js` to delegate to `chrome_launch` (with deprecation notice). The chart_scroll_to_date + 5 other `evaluate is not defined` bugs and the `tab_close` Chrome-vs-Electron bug are already fixed and pushed in `c89efd5`.
2. **Phase 4 — wire-in.** Add tv-mcp to `~/.claude/settings.json` MCP registrations. Document the dual-registration pattern (two MCP processes with different `TV_MCP_TARGET_FILTER` env vars → parallel TV sessions, no collisions). Deregister upstream `tradingview-mcp` once verified working.
3. **Live-TV smoke test.** Boot the server against an actual Chrome+TV session and exercise: `tab_picker` → `tab_pin symbol=GC1!` → `chart_get_state` → `tab_unpin`. The audit's whole point was multi-tab non-collision; nothing's been validated against a real chart yet.

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

- Should we deregister upstream `tradingview-mcp` from settings.json immediately after Phase 4 smoke test, or run dual for a session as belt-and-suspenders?
- For the dual-registration pattern, what names? Suggested: `tv-mcp-gc` (`TV_MCP_TARGET_FILTER=symbol=GC1!`), `tv-mcp-icc` (`title~ICC`).
