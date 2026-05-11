# TV MCP Audit — Scope for In-House Rewrite

**Audit date:** 2026-05-10
**Source:** Upstream `tradesdontlie/tradingview-mcp` v1.0.0 (vendored at `~/tradingview-mcp/`)
**Total upstream tools:** 78
**Used in skills/CLAUDE.md:** 51 (65%)
**Unreferenced:** 27 (35%)

---

## TIER 1 — Core (USE; must port verbatim)

These are referenced in 1+ skill or CLAUDE.md and represent the daily working set.

### Connection / health (3)
- `tv_health_check` — CDP liveness probe
- `tab_list` — enumerate Chrome tabs (already supports CDP `/json/list`)
- `tab_switch` — change active CDP target

### Chart state (8)
- `chart_get_state`
- `chart_set_symbol`
- `chart_set_timeframe`
- `chart_set_type`
- `chart_set_visible_range`
- `chart_get_visible_range`
- `chart_scroll_to_date` ⚠️ currently broken (`evaluate is not defined`)
- `chart_manage_indicator`

### Indicator data (10)
- `data_get_study_values`
- `data_get_indicator`
- `data_get_ohlcv` (with `summary=true` mode)
- `data_get_pine_lines`
- `data_get_pine_labels`
- `data_get_pine_tables`
- `data_get_pine_boxes`
- `data_get_strategy_results`
- `data_get_equity`
- `data_get_trades`

### Quote / symbol (2)
- `quote_get`
- `symbol_info`

### Pine editor (9)
- `pine_set_source`
- `pine_get_source`
- `pine_smart_compile`
- `pine_get_errors`
- `pine_get_console`
- `pine_save`
- `pine_open`
- `pine_new`
- `indicator_set_inputs`

### Replay (6)
- `replay_start` / `replay_step` / `replay_autoplay` / `replay_status` / `replay_stop` / `replay_trade`

### Drawing (4)
- `draw_shape` / `draw_list` / `draw_remove_one` / `draw_clear`

### Alerts / watchlist (5)
- `alert_create` / `alert_list` / `alert_delete`
- `watchlist_add` / `watchlist_get`

### UI / batch (5)
- `ui_open_panel`
- `ui_click`
- `ui_fullscreen`
- `capture_screenshot`
- `batch_run`
- `layout_switch`

**Subtotal: 52**

---

## TIER 2 — Include (clear use case, even if not yet used)

We haven't called these from skills, but they have obvious value and are cheap to port.

| Tool | Why include |
|---|---|
| `pane_list` | Already mentioned in handoff; multi-pane is essential for cross-asset views (perplaytual) |
| `pane_focus` | Required to drive `pane_list` |
| `pane_set_symbol` | Multi-pane workflow |
| `pane_set_layout` | Multi-pane workflow |
| `symbol_search` | Ticker discovery / fuzzy matching for new strategies |
| `tab_new` | Programmatic chart opening — needed for any multi-tab automation |
| `pine_check` | Used by `pine_smart_compile`; expose for granular control |
| `pine_compile` | Same |
| `pine_analyze` | Static analysis without TV — fast pre-flight check |
| `pine_list_scripts` | Pine workflow needs script enumeration |
| `tv_ui_state` | Useful for recovery skill (which panels are open?) |
| `tv_discover` | Periodic check for new TV API surface |
| `ui_evaluate` | Escape hatch — arbitrary JS in TV page context. Critical for the "debug it ourselves" model |
| `ui_keyboard` | Cmd+R, Cmd+W, Escape, Tab navigation. Needed for recovery flows |
| `ui_find_element` | Required to drive any UI automation we don't already cover |
| `indicator_toggle_visibility` | Hide noise in chart-analysis without removing/re-adding |

**Subtotal: 16**

---

## TIER 3 — Niche but cheap (include for completeness)

UI primitives — small implementation, future-proofs us against needing escape hatches later.

| Tool | Note |
|---|---|
| `ui_hover` | Tooltip-driven flows |
| `ui_mouse_click` | Coordinate-based clicks (when selectors fail) |
| `ui_scroll` | Some panels need scroll-into-view |
| `ui_type_text` | Drive search inputs, alert configs |
| `draw_get_properties` | Inspect existing drawings |
| `layout_list` | Saved layout enumeration |

**Subtotal: 6**

---

## TIER 4 — DROP / REWRITE

| Tool | Action | Reason |
|---|---|---|
| `tv_launch` | **Rewrite** as `chrome_launch` | We use Chrome, not TV Desktop. Helper that launches Chrome with `--remote-debugging-port=9222` if not already running. |
| `tab_close` | **Fix in place** | Currently broken (success-but-no-decrement). Add `tab_close_by_id` alongside as a CDP-native alternative. |
| `depth_get` | **Keep** | Reconsidered — order-book data could feed future strategies (DOM-based execution, liquidity-aware entries). No reason to drop a working tool. |

**Net dropped: 0. Two rewrites/fixes.**

---

## NEW tools (in-house MCP additions)

### Multi-tab support (the ICC-unblocking work)
- **`tab_pin <id | title-pattern | symbol-pattern>`** — pin the MCP to a specific Chrome tab. Held in-memory until `tab_unpin` or process exit.
- **`tab_unpin`** — clear the pin; revert to first-TV-tab default.
- **`tab_picker`** — enriched list of all TV tabs: id, title, URL-symbol, layout-id, last-active. Used by humans to choose; `tab_pin` accepts any of those as input.
- **Env var `TV_MCP_TARGET_FILTER`** — startup-time pin (e.g. `symbol=COMEX:GC1!` or `title~ICC`). Lets Claude Code register the MCP twice with different filters → two parallel sessions, two pins, no collision.

### Reliability
- **`tv_reset`** — programmatic version of the `tv-reset` skill: diagnose desync, attempt automated recovery, return verdict. Skill stays as the human-readable runbook.
- **`chrome_health`** — distinct from `tv_health_check`: reports Chrome version, total tabs, TV tab count, debug port liveness. The "is the platform alive?" probe.
- **`tab_close_by_id <id>`** — direct CDP `Target.closeTarget` call. Replaces broken upstream `tab_close`.

### Diagnostics
- **`mcp_log_tail`** — return last N lines of the MCP's own log. For "why did that call do nothing?" debugging.

**Subtotal: 8 new**

---

## Final scope (REVISED — fork-and-extend, not rewrite)

**Strategy:** Fork upstream into a new repo. Touch only what we change. Inherit everything else.

| Category | Action | Count |
|---|---|---|
| T1 + T2 + T3 inherited from upstream | leave alone | 74 |
| `tv_launch` → `chrome_launch` | rewrite | 1 |
| `tab_close` | bug fix in place | 1 |
| `chart_scroll_to_date` | bug fix in place (`evaluate is not defined`) | 1 |
| `depth_get` | keep (re-evaluated) | 1 |
| New tools (multi-tab pin + reliability + diagnostics) | add | 8 |
| **Total tools in-house MCP** | | **86** |

**Why fork-and-extend instead of rewrite:**
- 75 working tools = 75 things we don't have to debug from scratch
- Pine graphics extraction path (`study._graphics._primitivesCollection.dwglines...`) is hard-won upstream code — no reason to re-derive it
- Maintenance scope shrinks to ~10 files of delta, not 80
- Optional: occasional rebase against upstream pulls in their fixes/improvements
- We can still rewrite individual tools later if upstream code rots

---

## Architecture sketch

```
Claude Code (session A)  ─┐
                           ├─→ MCP server (process A, env: TV_MCP_TARGET_FILTER=symbol=GC) ─→ CDP :9222 ─→ Chrome tab "GC1!"
Claude Code (session B)  ─┘
                           ├─→ MCP server (process B, env: TV_MCP_TARGET_FILTER=symbol=ICC) ─→ CDP :9222 ─→ Chrome tab "ICC"
```

Same Chrome instance, two MCP processes, two pinned tabs, zero collision. Existing `~/.claude/settings.json` MCP registration just needs to be duplicated with different env vars.

---

## Implementation phases (REVISED)

1. **Phase 1 — Fork & connection layer** (~2 hrs)
   - New repo (e.g. `~/tv-mcp/`), copy upstream, `git init`
   - Patch `connection.js` to support tab-pinning (in-memory `pinnedTargetId`)
   - Add `TV_MCP_TARGET_FILTER` env var read at startup
   - Sanity-check: existing 78 tools still work against your live Chrome

2. **Phase 2 — Add the 8 new tools** (~3 hrs)
   - `tab_pin`, `tab_unpin`, `tab_picker` (tab.js extension)
   - `chrome_launch` (replaces `tv_launch`)
   - `tab_close_by_id` (CDP `Target.closeTarget`)
   - `tv_reset` (programmatic version of skill)
   - `chrome_health`
   - `mcp_log_tail`

3. **Phase 3 — Bug fixes** (~2 hrs)
   - `chart_scroll_to_date`: trace the `evaluate is not defined` error, fix
   - `tab_close`: investigate why count doesn't decrement (likely Electron-keyboard-shortcut path that doesn't apply to Chrome)
   - Mark or delete `tv_launch` (keep as no-op stub that points at `chrome_launch`)

4. **Phase 4 — Wire in + parallel-session config** (~1 hr)
   - Add new MCP to `.claude/settings.json`
   - Document the dual-registration pattern for parallel TV sessions
   - Run side-by-side with upstream for one session, then deregister upstream

**Estimated total: ~1 focused day** (down from 2–3 — fork-and-extend is ~3× faster than rewrite).
