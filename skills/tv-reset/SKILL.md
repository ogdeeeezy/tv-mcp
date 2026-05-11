---
name: tv-reset
description: Detect and recover from TradingView MCP desync (state mismatch, ghost tabs, broken evaluate). Use whenever chart tools return wrong-symbol data, tab_close silently fails, or chart_scroll_to_date errors with "evaluate is not defined".
---

# TradingView MCP Reset

The upstream MCP (tradesdontlie/tradingview-mcp) periodically desyncs from the TradingView Desktop CDP session. This skill detects the desync and walks through the recovery sequence.

## Symptoms (any one = run this skill)

- `chart_get_state` reports symbol X but `quote_get` / `data_get_ohlcv` return data for symbol Y
- `tab_list` shows multiple tabs sharing the same `chart_id`
- `tab_close` returns `success: true` but tab count doesn't decrement on a follow-up `tab_list`
- `chart_scroll_to_date` errors with `evaluate is not defined`
- `pine_*` tools return stale source from a different script than what's loaded

## Step 1: Diagnose

Run all four in parallel — small payloads, no side effects:

1. `tv_health_check` → confirms CDP connection is alive
2. `chart_get_state` → records reported symbol/timeframe/chart_id
3. `tab_list` → inventory of all tabs and their chart_ids
4. `quote_get` → records the symbol the data path actually resolves to

**Desync confirmed if:**
- `chart_get_state.symbol` ≠ `quote_get` symbol field, OR
- `tab_list` has 2+ tabs sharing one `chart_id`, OR
- Either tool errors with `evaluate is not defined`

If all four agree on symbol and chart_ids are unique → no desync. Stop here.

## Step 2: Try Automated Recovery

Attempt these in order, re-running `tab_list` + `chart_get_state` between each step to verify progress:

1. **Switch to the intended tab** — `tab_switch` to the tab whose `chart_id` matches `chart_get_state`. Sometimes the active-tab pointer is what's stale.
2. **Close orphan tabs** — for each duplicate `chart_id` in `tab_list`, call `tab_close` on the older one. Re-list after each close. If the count doesn't drop, automated recovery has failed → go to Step 3.
3. **Re-set symbol** — call `chart_set_symbol` with the symbol that `chart_get_state` claims. Forces the chart to re-resolve.

After each step, verify with `quote_get` — if the returned symbol now matches `chart_get_state`, we're recovered. Skip to Step 4.

## Step 3: Manual Reset (when automation fails)

Tell the user exactly this:

> The MCP can't recover this on its own. Please:
> 1. In TradingView Desktop, close any tabs you don't need (especially duplicates)
> 2. Click into the chart you want to work with
> 3. Press **Cmd+R** to reload that chart
> 4. Tell me when it's done

Wait for confirmation. Don't run any chart tools while waiting — they'll just re-trigger the desync.

## Step 4: Verify Recovery

After Step 2 succeeds OR the user confirms manual reload:

1. `tv_health_check` → connection alive
2. `chart_get_state` → record symbol/timeframe
3. `quote_get` → must match symbol from chart_get_state
4. `chart_scroll_to_date` with any recent date → must NOT error with "evaluate is not defined"
5. `tab_list` → no duplicate chart_ids

All five clean → recovery complete. Resume the original task.

If `chart_scroll_to_date` still errors after a manual reload, the TV Desktop process itself needs restarting (`tv_launch` won't help — fully quit TradingView and reopen).

## What NOT to Do

- Don't keep retrying `tab_close` on a tab that won't decrement — that's how we know automated recovery has failed
- Don't run `chart_set_symbol` before diagnosing — it can mask the desync without fixing it, and we lose the diagnostic signal
- Don't skip Step 1 even if the symptom is obvious — the diagnostic snapshot tells us which recovery path to take and gets logged for the eventual root-cause fix
- Don't claim "MCP is fixed" after Step 2 without running Step 4 — partial recoveries are common

## Notes for Future Hardening

Each invocation of this skill is evidence for the in-house MCP rewrite (tracked separately). When running Step 1, note:
- Which exact symptom triggered it
- Which automated step (if any) recovered it
- Whether `chart_scroll_to_date` was among the broken tools

Patterns across invocations will tell us which CDP lifecycle bugs to prioritize when we replace the upstream server.
