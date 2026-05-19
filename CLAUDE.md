# TradingView MCP — Claude Instructions

69 tools for reading and controlling a live TradingView Chrome session via CDP (port 9222).

## Chrome setup (READ BEFORE session opening protocol)

The MCP talks to Chrome over CDP on port 9222. Before anything else works, Chrome must be running with the debug port bound — and Chrome 136+ refuses to bind that port on the default user-data-dir as an anti-credential-theft measure. **The fix is non-negotiable: launch Chrome with `--user-data-dir=<non-default>`.**

### On this machine (claudesplayground)

Durable isolated profile lives at:

```
~/Library/Application Support/tv-mcp-chrome
```

Signed in as `withthechefboy@gmail.com`. Chrome Sync brings in extensions and bookmarks automatically; the TradingView login is local to this profile (TV is not on Google sync). This is a separate Chrome instance from the user's main browsing Chrome — both can run side-by-side as different dock icons.

To launch (or check it's already up):

```
chrome_launch user_data_dir="~/Library/Application Support/tv-mcp-chrome"
```

`chrome_launch` is idempotent — if CDP is already alive on 9222, it returns early with the existing state. Run it at session start as a no-cost sanity check.

### Failure-mode dictionary

If you see one of these symptoms, the cause is almost always Chrome-profile-related, not network or firewall:

| Symptom | Real cause | Fix |
|---|---|---|
| `chrome_launch` returns `success: false, action: "launched_but_not_responsive"` | Chrome 136+ refused to bind 9222 on the default profile path | Re-run with `user_data_dir="~/Library/Application Support/tv-mcp-chrome"` |
| `chrome_health` returns `alive: false, error: "fetch failed"` | Same. Port never bound. | Same. |
| `lsof -i :9222` returns nothing despite a Chrome process being alive with `--remote-debugging-port=9222` in its args | Same. The flag is accepted by Chrome's argv parser but the security check rejects binding. | Same. |
| `chrome_launch` succeeds, `tab_picker` returns 0 tabs | Right profile, but no TV tab open yet | User needs to open `https://www.tradingview.com/` in the isolated Chrome window |
| `tab_pin symbol=GC1!` returns success but the wrong tab gets pinned | Title regex didn't extract `symbol` from this tab's title format | Use `tab_pin title=...` or `tab_pin url=...` instead (see Known gotchas) |

### What NOT to waste time on

These were explored exhaustively when the Chrome 136+ block was first hit — they are all dead ends:

- **Firewall / Tailscale / VPN debugging.** Chrome never binds the port, so no firewall has a chance to interfere. Network stack is fine.
- **Killing and relaunching Chrome with the default profile.** Same restriction fires every single time.
- **Trying different ports.** Port 9222 is fine; the block is profile-based.
- **Passing the default profile path explicitly via `--user-data-dir`.** Chrome's check is path-based ("does this resolve to the OS-default location") not flag-presence-based. Explicit-default also fails.
- **Singleton-attach hypothesis.** Was the initial wrong guess. Even with all Chrome processes killed first, the default-profile launch still fails identically.

### Two-Chrome pattern

User keeps their normal default-profile Chrome for browsing. The tv-mcp Chrome (isolated profile) is launched only when MCP work is happening. Both can run simultaneously; macOS handles two Chrome instances cleanly. When you're done with MCP work, the tv-mcp Chrome can be closed to free RAM — the profile data persists at `~/Library/Application Support/tv-mcp-chrome` for next time.

## Session opening protocol (READ THIS FIRST)

Before any chart operation, **ask the user which symbol or chart they want to work on.** Never assume. Then bind a lane to it:

1. Ask: "Which symbol/chart? (e.g., RBLX, GC1!, an open layout title)"
2. Call `tab_registry` to see which tabs are already claimed by other live Claude sessions. Skip any tab another session owns unless the user explicitly wants to take it over.
3. Call `tab_picker` (on whichever `tv-mcp-*` lane is free) to list TradingView tabs currently open in Chrome.
4. Pin: `tab_pin symbol=<their answer>` — or `tab_pin id=<targetId>` if disambiguating by exact tab. Pin is per-MCP-process state AND a claim in the shared registry; once set, every subsequent CDP call from this MCP goes to that tab until `tab_unpin`.
5. From then on, use that lane (`mcp__tv-mcp-a__*` etc.) for that chart for the rest of the session.

If `tab_pin` returns `{conflict: true, owner: {...}}`, another live Claude session has already claimed that tab. Default behavior: pick a different tab. If the user knows the other session is dead or wants to take over, retry with `force: true`.

If the user wants to work on **multiple charts in parallel**, repeat the pin step on a different lane (`tv-mcp-b`, `tv-mcp-c`, …). Each lane = one independent pin slot.

## Multi-lane registration

`/Users/claudesplayground/.mcp.json` registers six identical unfiltered lanes: `tv-mcp-a` through `tv-mcp-f`. No preset symbols — each lane pins at runtime to whatever the user asks for.

To add more lanes (e.g., for very wide parallel work), append entries with the same shape, incrementing the suffix. Each idle lane is a small node process — keep the total reasonable on memory-constrained machines.

If `tab_picker` returns nothing or `chrome_health` shows CDP unreachable, run `chrome_launch` first.

## Cross-instance pin registry

Multiple Claude Code sessions can run tv-mcp processes against the same Chrome. Coordination is at the **tab level**, not the lane level — each session has its own `tv-mcp-a..f` processes, but they all share Chrome's tabs. Two sessions pinned to the same tab will race on every CDP call.

The registry at `~/.tv-mcp-registry.json` prevents accidental double-claims:

- `tab_pin` claims the tab in the registry; conflicts with another live PID return `{success: false, conflict: true, owner: {...}}` instead of pinning.
- `tab_unpin` releases the claim.
- `tab_registry` is a read-only view of every active claim across all sessions — call it before `tab_pin` if multi-session work is likely.
- Dead-PID entries auto-prune on every registry read, so an unclean shutdown does not lock out future sessions.
- `force: true` on `tab_pin` overrides an existing live claim and reports the displaced owner. Use only when the other session is known stuck.

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Known gotchas

### MCP server processes don't hot-reload

The six `tv-mcp-a` through `tv-mcp-f` processes are spawned by Claude Code at session start and read the code that exists *at that moment*. If you modify `src/` mid-session, the running processes keep using the old code — your changes only take effect on the next Claude Code session restart. The lanes shown in `claude mcp list` look fine because they're still alive; they just have stale logic.

How to confirm a running lane is stale: call a tool you know was added recently. If it's not registered, the lane is pre-change. The standard recovery is a Claude Code restart — there is no per-process hot reload.

### `chrome_launch`'s 5-second wait can be a false negative

`chrome_launch` polls CDP for 5 seconds after starting Chrome. On a truly cold launch (system was idle, profile is large, Chrome is paging in), CDP can take 6–10s to come up — `chrome_launch` then returns `launched_but_not_responsive` even though Chrome is fine. Always probe `chrome_health` once after a `launched_but_not_responsive` response before assuming failure. The Chrome 136+ block is permanent (lsof never shows the port); a slow-cold-start is transient (lsof will show the port shortly).

### Pin state vs. registry state

`setPin` / `clearPin` in `connection.js` are in-process-only (used for internal reconnect on transient CDP drops). `claimAndPin` / `releaseAndUnpin` also touch the cross-instance registry. The `tab_pin` and `tab_unpin` tools go through the registry-aware path. If you add a new internal reconnect flow, use the bare `setPin` — do not double-claim in the registry on every reconnect.

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ Chrome (isolated user-data-dir)
                                                                  ↓
                                                          TradingView web app
```

Phase 3 (2026-05) deprecated the original TradingView Desktop / Electron path. `tv_launch` now delegates to `chrome_launch`. The MCP only talks to web-Chrome; there is no Electron path left.

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`
