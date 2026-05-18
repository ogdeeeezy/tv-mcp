# HANDOFF-tv-mcp

> Fresh fork of `tradesdontlie/tradingview-mcp` at `ogdeeeezy/tv-mcp` (split 2026-05-11 from `~/tradibos/`).

## Current state

**v1.0.0 shipped 2026-05-18.** Tag pushed, GitHub release live at https://github.com/ogdeeeezy/tv-mcp/releases/tag/v1.0.0. Onboarding: `git clone → npm install → npm run setup` (or `tv setup`). CI green on `{ubuntu, macos, windows} × node {18, 20, 22}`. **80/80 unit tests.** Issue #1 closed end-to-end (verified live on `NYMEX:CL1!` 4h). README and release notes both lead with `tv setup`.

**No open work.** All S4/S5 carry-overs (release tag, README polish, CL position sanity-check) are done in S6.

## When to open this project again

Only on real demand:
- A friend installs from the GH release and hits a bug — file an issue, fix on a branch, cut v1.0.1.
- Upstream `tradesdontlie/tradingview-mcp` lands a change worth vendoring in — cherry-pick or rebase.
- A new feature ask (more lanes, a new MCP tool, a Pine-side helper) — start a fresh PROGRESS session.

No periodic maintenance scheduled. CI catches Node-version regressions automatically.

## Known gotchas (read before editing `src/`)

- **MCP server processes don't hot-reload.** Six `tv-mcp-a..f` processes spawn at Claude Code session start and freeze on that code. To pick up `src/` changes, restart Claude Code.
- **`evaluate` alias trap** in `src/core/chart.js`, `src/core/drawing.js`, `src/core/replay.js`: module imports `evaluate as _evaluate`, so bare `evaluate(...)` calls only work after `const { evaluate } = _resolve(_deps);`. New functions must mimic the existing ones.
- **Pin state ≠ registry state.** `setPin`/`clearPin` in `connection.js` are in-process-only (transient reconnect). `claimAndPin`/`releaseAndUnpin` also touch `~/.tv-mcp-registry.json`. Tools use the registry path; internal reconnect must use bare `setPin`.
- **vm-context object identity** (S5) — when unit-testing `IS_STRATEGY_JS` / `SCRAPE_STRATEGY_TESTER_JS` via `vm.runInNewContext`, objects returned from the vm context have a cross-realm prototype. `assert.deepEqual({}, vmCtx.metrics)` fails strict-equality even when both are empty. Use `Object.keys(...).length === 0` (or non-strict `deepEqual`) for empty-object checks across realms. See `tests/data_strategy_helpers.test.js`.
- **`chrome_launch`'s 5s wait can be a false negative** on truly cold starts. If it returns `launched_but_not_responsive`, probe `chrome_health` once before assuming failure — Chrome 136+ block is permanent (lsof never shows the port); slow-cold-start is transient.
- **`mcp_log_tail` is opt-in.** Set `TV_MCP_LOG=1` (writes `~/.tv-mcp.log`) or `TV_MCP_LOG_FILE=/path` at server start.
- Project-local INSIGHTS: `INSIGHTS-tv-mcp.md` (Chrome 136+ block, tab-title format drift, pin-vs-registry layering, tab-scoped registry coordination).

## Hot files (only if you have to dig in)

- `src/core/data.js` — `IS_STRATEGY_JS` + `SCRAPE_STRATEGY_TESTER_JS` exports power the #1 fix; modify both helpers together if widening detection further
- `tests/data_strategy_helpers.test.js` — vm-context tests for the above (12 cases)
- `src/cli/commands/setup.js` — onboarding command (S4)
- `src/connection.js` — pin/filter state, registry-aware claimAndPin/releaseAndUnpin, exit hooks
- `src/core/pin_registry.js` — file-backed cross-instance claim map
- `CLAUDE.md` — Chrome setup section + failure-mode dictionary
- `README.md` — quickstart (npm run setup), manual flow in `<details>`, CLI examples lead with `tv setup`

## Related repos / locations

- `~/tradibos/` (strategy library, `ogdeeeezy/tradibos`)
- `~/lib/schwab-market-data/` and `/root/schwab-market-data/` on H2 (paper trader using v6a CL on `NYMEX:CL1!`). CL position as of 2026-05-18: entry $95.64, stop $85.24, trail inactive, last 4h close $102.43 = +$6.79/contract unrealized. Healthy.
- `~/tradingview-mcp.backup-2026-05-11/` + `~/tv-mcp.rsync-staging-2026-05-11/` — pre-split backups, safe to delete when confident

## Open questions for user

None.
