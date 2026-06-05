# PROGRESS-tv-mcp

> Sessions 1-5 archived → `docs/archive/archive-progress-tv-mcp.md`

---

## Session 8: 2026-06-05 — Pine editor multi-instance claim (Fix 3 of 3 shipped)

### Done
- **Fix 3 — multi-instance Pine editor claim registry** (`2f4fbb6`) — bumped `~/.tv-mcp-registry.json` v1→v2 with backwards-compat v1 read; added singleton `pine_editor` slot alongside existing tab pins; new tools `pine_claim` / `pine_release` / `pine_claim_status`; `requirePineClaim()` gate on every write tool (`newScript`, `setSource`, `save`, `smartCompile`, `compile`); `TV_MCP_PINE_WRITE_UNGATED=1` escape hatch (off by default). Process-exit cleanup hooks into existing `releaseAllSync`. 12 new tests (claim/release/conflict-via-real-child-process/force-override/dead-PID-prune/v1-backward-compat). **34/34 pin_registry tests pass, 47/47 other unit tests pass.**
- Network probe for Fix 1 started but paused before triggering "New" — lane `tv-mcp-e` pinned to chart `YKaDEilf` (GC1! 1h), fetch+XHR interceptor installed in `window.__pineProbe.calls`. Both die on Claude Code restart, so next instance re-pins fresh.

### Decisions
- **Shipped Fix 3 before Fixes 1+2.** It's the cross-cutting safety net — even if 1+2 land buggy later, two instances can no longer silently clobber each other on shared TV cloud script slots. The pin_registry pattern already existed (Session 3 work), so Fix 3 was a clean extension with no new infra.
- **Chart-per-lane workflow isolation does NOT replace Fixes 1+2.** The 2026-06-05 incident was a single-instance bug (pine_new lies about creating + pine_save silently no-ops). Separate charts per workstream reduce blast radius from "any account script" to "whatever the tab last loaded," but don't fix the bug. User confirmed proceeding with Fix 1+2 next session.
- **Singleton (account-global) pine_editor claim, not per-tab.** TV cloud script slots are shared across the whole account, so coordination must be too. Spec Layer A.

### Next
- **Carryover: Fix 1 — `pine_new` actually creates a server-side slot.** Network probe gates this. First move next session: re-pin lane `e` to a fresh chart (or `YKaDEilf` again), reinstall the fetch interceptor (see `tests/recap` HTML for the snippet), trigger TV's "New script" menu programmatically, capture the pine-facade POST. Implementation pattern is in `SPEC-pine-safe-create.md` — POST to discovered endpoint → call `openScript()` to rebind editor → return real `scriptIdPart`.
- **Carryover: Fix 2 — reliable `save` with verification.** Monaco action `vs.editor.ICodeEditor:1:save.script` (proven in 2026-06-05 recovery) + pine-facade `/get/{id}/last` poll. Drop-in once Fix 1 ships.
- **After Fix 1+2 ship:** Claude Code restart + live integration test (two `pine_new` calls → +2 `pine_list_scripts` entries with `tv-mcp-probe-*` names; set source + save + verify roundtrip via pine-facade). Probe scripts named `tv-mcp-probe-<unix-ts>` are pre-approved as throwaway.

---

## Session 7: 2026-05-19 — v1.0.1 polish & cleanup

### Done
- **README MCP-config example surfaced** — six-lane JSON block now visible in the main Quick Start flow instead of hidden behind `<details>`. A separate `<details>` collapsible documents the single-server variant for users who only want one lane. Someone reading the README in isolation now sees the correct config shape without running `tv setup`.
- **Stale "Symbol regex misses titles without parentheses" gotcha removed from `CLAUDE.md`** — the underlying bug was already fixed in `55a55e6` (parser widened to handle both parenthesized and leading-symbol formats, 14 tests covering both shapes + null-return cases). Documentation drift, not new code.
- **Pre-split backups deleted** — `~/tradingview-mcp.backup-2026-05-11/` (145M) and `~/tv-mcp.rsync-staging-2026-05-11/` (6.7M). `diff -rq` confirmed all unique content is either pre-split tradibos material (lives in `~/tradibos/` now) or deprecated Electron launch scripts (Phase 3 removed). `MCP-AUDIT.md` already merged in as `docs/AUDIT.md` (byte-identical). ~152M reclaimed.
- **v1.0.1 tagged + GitHub release published** covering "polish & cleanup."
- 80/80 unit tests still pass.

### Decisions
- **No new tests for `parseSymbolFromTitle`** — the three categories the task asked for (leading-symbol, parenthesized, null-return) are already covered with 9 cases across the existing suite. Adding redundant tests would just be noise.

### Next
- No carry-overs. v1.0.1 is the end of the polish pass.
- Next tv-mcp session opens only on real demand: a friend hits a bug, an upstream change to vendor in, or a new feature ask.

---

## Session 6: 2026-05-18 — v1.0.0 released, README polish, CL position checked

### Done
- **v1.0.0 tagged + GitHub release published** — annotated tag on `9e26de3`, release at https://github.com/ogdeeeezy/tv-mcp/releases/tag/v1.0.0. Notes cover: one-command onboarding (`npm run setup` / `tv setup`), issue #1 closed end-to-end, 80/80 tests, CI matrix `{ubuntu, macos, windows} × node {18, 20, 22}`, six-lane default, no-npm rationale.
- **README CLI block polished** (`9e26de3`) — `tv setup` now leads both the Quick Examples and the All Commands list. Added a sentence explaining what it does (isolated profile + CDP launch + config snippet). Was a S4/S5 carry-over.
- **Schwab CL position sanity-checked** on H2 — log shows position alive (entry $95.64, stop $85.24, trail still inactive), cron running on schedule. Latest 4h close $102.43 → position is **+$6.79/contract unrealized**, not in drawdown.
- Token refresh blip 6:15-7:15 AM ET 2026-05-18 (recovered by 8:15) — single transient, no follow-up needed unless it recurs.

### Decisions
- **Release notes published to GitHub, not as a separate CHANGELOG.md.** Single-source-of-truth at the GitHub release page; if a CHANGELOG ever matters for offline browsing, generate it from `gh release list --json` later.

### Next
- All shipping-readiness work is done. No carry-overs.
- Next tv-mcp session opens only on real demand.
