# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp` (split 2026-05-11 from `~/tradibos/`).

## Current state

**v1.0.0 — shipping-ready for friends. Issue #1 closed end-to-end.** Onboarding: `git clone → npm install → npm run setup`. The setup command creates an isolated Chrome profile, launches Chrome with CDP on the right flags, and prints a six-lane `mcp_config` block to paste into `~/.claude/.mcp.json`. CI runs on `{ubuntu, macos, windows} × node {18, 20, 22}`. **80/80 unit tests pass** (was 68/68 before S5 added vm-based helper tests). **npm publish intentionally skipped** — GitHub clone covers the install story without the token/2FA/semver overhead.

## Immediate next steps (pick one)

1. **(Ceremonial)** `git tag v1.0.0 && gh release create v1.0.0` to mark the shareable cut. Notes can pull from Sessions 4 + 5 in PROGRESS.
2. **(Small polish)** Update README §"CLI" examples block to lead with `tv setup` — it's in the help output but the examples still open with `tv status` / `tv quote`.
3. **(Context switch)** Tradibos / Schwab work — schwab CL position is taking unrealized drawdown post-S5 (`net_profit` $20,532.50 → $18,522.50 on the same backtest range). Check H2 cron logs (`ssh root@100.123.131.45`, `/root/schwab-market-data/`) for trail-stop activity on the open CL position.

## Known gotchas

- **vm-context object identity** (new in S5) — when unit-testing `IS_STRATEGY_JS` / `SCRAPE_STRATEGY_TESTER_JS` via `vm.runInNewContext`, objects returned from the vm context have a cross-realm prototype. `assert.deepEqual({}, vmCtx.metrics)` fails strict-equality even when both are empty. Use `Object.keys(...).length === 0` (or non-strict `deepEqual`) for empty-object checks across realms. See `tests/data_strategy_helpers.test.js`.
- **`evaluate` alias trap** in `src/core/chart.js`, `src/core/drawing.js`, `src/core/replay.js`: module imports `evaluate as _evaluate`, so bare `evaluate(...)` calls only work after `const { evaluate } = _resolve(_deps);`. New functions must mimic the existing ones.
- **Pin state ≠ registry state.** `setPin`/`clearPin` in `connection.js` are in-process-only (transient reconnect). `claimAndPin`/`releaseAndUnpin` also touch `~/.tv-mcp-registry.json`. Tools use the registry path; internal reconnect must use bare `setPin`.
- **MCP server processes don't hot-reload.** Six `tv-mcp-a..f` processes spawn at Claude Code session start and freeze on that code. To pick up `src/` changes, restart Claude Code.
- **`chrome_launch`'s 5s wait can be a false negative** on truly cold starts. If it returns `launched_but_not_responsive`, probe `chrome_health` once before assuming failure — Chrome 136+ block is permanent (lsof never shows the port); slow-cold-start is transient.
- **`mcp_log_tail` is opt-in.** Set `TV_MCP_LOG=1` (writes `~/.tv-mcp.log`) or `TV_MCP_LOG_FILE=/path` at server start.
- Project-local INSIGHTS: `INSIGHTS-tv-mcp.md` (Chrome 136+ block, tab-title format drift, pin-vs-registry layering, tab-scoped registry coordination).

## Hot files

- `src/core/data.js` — `IS_STRATEGY_JS` + `SCRAPE_STRATEGY_TESTER_JS` exports power the #1 fix; modify both helpers together if widening detection further
- `tests/data_strategy_helpers.test.js` — vm-context tests for the above (12 cases)
- `src/cli/commands/setup.js` — onboarding command (S4)
- `src/connection.js` — pin/filter state, registry-aware claimAndPin/releaseAndUnpin, exit hooks
- `src/core/pin_registry.js` — file-backed cross-instance claim map
- `CLAUDE.md` — Chrome setup section + failure-mode dictionary
- `README.md` — quickstart (npm run setup), manual flow in `<details>`

## Related repos / locations

- `~/tradibos/` (strategy library, `ogdeeeezy/tradibos`)
- `~/lib/schwab-market-data/` and `/root/schwab-market-data/` on H2 (paper trader using v6a CL on `NYMEX:CL1!`)
- `~/tradingview-mcp.backup-2026-05-11/` + `~/tv-mcp.rsync-staging-2026-05-11/` — pre-split backups, safe to delete when confident

## Open questions for user

None — issue #1 closed, no carryovers requiring user input.
