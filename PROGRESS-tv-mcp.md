# PROGRESS-tv-mcp

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
