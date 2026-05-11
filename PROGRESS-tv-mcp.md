# PROGRESS-tv-mcp

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
