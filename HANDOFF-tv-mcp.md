# HANDOFF-tv-mcp

> Fork at `ogdeeeezy/tv-mcp` (split 2026-05-11 from `~/tradibos/`).

## Current state

**Session 14 (2026-06-10): clean rest state. All open follow-ups closed. Harness structurally sound for trading-strategy development.**

`pine_save({scriptIdPart})` end-to-end verified through the MCP tool on `tv-mcp-d` (commit `e98a42b`). Created disposable slot → `pine_open` → `pine_set_source` → `pine_save({scriptIdPart})` returned `action: "saved_to_existing"`, `version: 1.0 → 2.0`, `verified: true` via pine-facade `/get/last` cross-check. `pine_list_scripts` confirmed slot id unchanged, name preserved, no duplicate. Slot `pine_delete`d cleanly. The in-place edit workflow (`pine_open` → edit → `pine_save({scriptIdPart})`) is now the verified path.

**Structural audit summary** (Session 14): chrome plumbing, multi-instance coordination, Pine CRUD, chart reading, test coverage (104/104 unit), and docs are all current. The 3 pre-existing e2e drift failures (`tv_launch` binary path, `bottomWidgetBar.hideWidget` removed, `replay_stop` state assertion) and the cosmetic `ICC rv1 Strategy` title typo are parked in `~/obsidian/agenting/projects/tradingview-mcp/tv-mcp-housekeeping.md` with trigger conditions for when to pull each out. None block strategy dev.

`pine_delete` tool wired against the captured pine-facade endpoint. POST `https://pine-facade.tradingview.com/pine-facade/delete/<urlencoded-id>` (subdomain matters — prior 401 probe was on www host). Accepts `{name?, scriptIdPart?}`, scriptIdPart wins on conflict, name lookup is case-insensitive, refuses on ambiguous match (PINE_DELETE_AMBIGUOUS with matches[] returned). Requires `pine_claim`. Verifies by re-listing post-delete.

**openScript rebinding gap closed (Session 12, `e0e1cc9`).** `openScript` runs `new_indicator` before `setValue`, mirroring `newScript`'s safety pattern. Editor lands as unbound draft, persisting back via `pine_save({name})` hard-409s on duplicate names; `pine_save({scriptIdPart})` is the supported in-place path.

**Fix 1+2 closed out. Patch verified green end-to-end and pushed (`e7b4a2f`, 2026-06-09 — Session 11).** Fix 3 shipped 2026-06-05.

Session 11 ran the proof-gate sequence cleanly with a force-claim coordinated against the live ICC instance:

```
pine_claim(force=true)        → claimed
pine_new(indicator)           → unbound_draft_created, model_uri: ...?placement%3Ddialog
pine_set_source               → lines_set: 4
pine_save(name=...)           → action: saved_as_new, verified: true
                                scriptIdPart: USER;b465c8a4e8854a58956e59822e644fbf
pine_list_scripts             → +1 entry, slot present
pine_get_source               → matches input byte-for-byte
pine_release                  → released
```

ICC rv3 — Spec Viz (v11.0) untouched throughout. Tests: 94/94 unit pass. The 3 e2e failures are pre-existing TV-side drift (deprecated `tv_launch` binary path, `bottomWidgetBar.hideWidget` removed, `replay_stop` state assertion) — not touched by this patch.

## Immediate next action

**No outstanding work on the harness.** Resume trading-strategy development at the project level (`~/tradibos/`, `~/lib/schwab-market-data/`, etc.). The substrate is ready.

If a future session needs to fix the parked items, the housekeeping subnode is at `~/obsidian/agenting/projects/tradingview-mcp/tv-mcp-housekeeping.md` and has trigger conditions for each.

**If running `npm test`:** ensure no other Claude/CDP process is hitting Chrome. A background test run during Session 11 reported 60 failures starting with an 18-minute `chart_set_symbol` timeout — caused by CDP contention with live `ui_evaluate` probes, NOT real regressions. On a quiet Chrome, expect ~157/160 (3 pre-existing drift failures are parked). Anything in the 80-100 pass range means Chrome is busy; close other lanes and retry.

All known follow-ups closed:

~~1. Per-id overwrite endpoint.~~ **CLOSED (Session 13, `d1a52a2`; smoke-test verified Session 14, 2026-06-10).** Endpoint: `POST pine-facade.tradingview.com/pine-facade/save/next/<urlencoded-id>?allow_create_new=false&name=<urlencoded-name>` with FormData `source`. Captured via fetch interceptor while user did Cmd+S on a `bound` editor (opened "ICC rv1 Strategy" via TV's UI). `pine_save` extended with `scriptIdPart` arg that wins over both bound and unbound default paths — caller-named destination is safer than relying on editor binding. **Smoke test PASS:** `pine_new(name="smoke-test-pine-save-2026-06-10") → pine_open(name=...) → pine_set_source(<modified>) → pine_save({scriptIdPart})` returned `action: "saved_to_existing"`, `version: 1.0 → 2.0`, `verified: true`; `pine_list_scripts` showed slot name preserved (no rename, no duplicate), title picked up from new `indicator()` declaration, modified timestamp current. Slot then `pine_delete`d cleanly. End-to-end path is green.

~~2. Capture the real delete endpoint.~~ **CLOSED (Session 13, `6e4513b`).** Endpoint was `POST pine-facade.tradingview.com/pine-facade/delete/<urlencoded-id>` — subdomain difference was the entire bug. Prior www-host probe got 401 because cookies/origin context differed. Wired into `pine_delete` tool with name/scriptIdPart targeting + post-action verify.

## Reference (still valid)
- `POST /pine-facade/save/new?name=<urlencoded>&allow_overwrite=true|false` (FormData `source=`) → creates slot, returns `body.result.metaInfo.scriptIdPart`. TV normalizes line-endings to `\r\n`.
- `GET /pine-facade/get/<urlencoded-id>/<version|"last">` → fetches source.
- Monaco actions reachable via `editor.getSupportedActions()`: `new_indicator`, `new_strategy`, `open.script`, etc. (`.run()` them).
- Monaco commands NOT in actions: `:save.script` via `editor._commandService.executeCommand` (gated on `isSaveEnabled`).
- Title button `[data-qa-id="pine-script-title-button"]` shows bound slot name or "Untitled script". **Secondary signal only** — see gotcha below.

## Known gotchas
- **`isSaveEnabled` + `placement%3Ddialog` are the real safety fuse, not the title button.** When `new_indicator` action runs, the editor's model swaps to one whose URI contains URL-encoded `placement%3Ddialog` and `isSaveEnabled` flips to false. `save.script` is gated on `isSaveEnabled`, so it noops on the unbound model — the bound slot is never touched. The title button DOM (`[data-qa-id="pine-script-title-button"]`) is a secondary signal: it can lag the active editor state and can pick up stale elements when both main-pane and dialog-popout DOMs coexist. Read `isSaveEnabled` for truth; read the title button for human-readable context only.
- **There is only ONE Monaco editor instance at a time.** `env.editor.getEditors()` returns length 1. When TV swaps to a dialog popout, the editor's MODEL changes (new URI), but it's the same Monaco instance. Stale `.monaco-editor.pine-editor-monaco` DOM elements may linger from previous mounts — don't confuse a stale DOM node with a second editor.
- **URI placement comparison uses URL-encoded form.** Model URIs serialize `?placement=dialog` as `?placement%3Ddialog`. Code that sniffs the URI must match `placement%3Ddialog` (or decode first), not `placement=dialog`.
- **FIND_MONACO returns `{editor, env}` NOT the monaco namespace.** `m.editor` = editor instance (has `setValue`/`getValue`/`getModel`/`getSupportedActions`). `m.env` = namespace (has `editor.getEditors`). Session 10's regression was getting this backwards (now fixed in `e7b4a2f`).
- **MCP processes don't hot-reload.** Restart Claude Code to pick up `src/` edits.
- **Singleton pine_editor claim is account-global.** Two MCP processes can't both write Pine — escape hatch is `TV_MCP_PINE_WRITE_UNGATED=1`. Stale claims auto-prune on registry read.
- **`ui_evaluate` does NOT await Promises** — async IIFEs return `{}`. Stash result on `window.__X`, poll via subsequent sync evaluate.
- **`evaluate` alias trap** in `src/core/chart.js`/`drawing.js`/`replay.js`: imported as `_evaluate`, requires `const { evaluate } = _resolve(_deps)` before bare calls.
- **`chrome_launch`'s 5s wait can be a false negative** on cold starts — probe `chrome_health` before assuming failure.
- **Pin state ≠ registry state.** `setPin`/`clearPin` in `connection.js` are in-process-only; `claimAndPin`/`releaseAndUnpin` also touch `~/.tv-mcp-registry.json`. Tools go through the registry path; internal reconnect uses bare `setPin`.

## Hot files
- `src/core/pine.js` — Fix 1+2 fully landed in `e7b4a2f`. Session 12 `openScript` rebinding in `e0e1cc9`. Session 13 `deleteScript` + `selectDeleteTarget` in `6e4513b`. Next change-of-interest: per-id overwrite endpoint (`saveTo({scriptIdPart, source})`).
- `src/core/pin_registry.js` — v2 with pine_editor singleton (Fix 3).
- `src/tools/pine.js` — claim/release/status tools at the bottom; `pine_delete` registered next to `pine_list_scripts`.
- `tests/pin_registry.test.js` — 12 pine_editor cases.
- `tests/pine_delete.test.js` — 10 selectDeleteTarget cases (Session 13).
- `SPEC-pine-safe-create.md`, `INCIDENT-pine-overwrite-2026-06-05.md`.

## Related repos
- `~/tradibos/`, `~/lib/schwab-market-data/` + `/root/schwab-market-data/` on H2, `~/tradibos-nautilus/` on H2 (Pine slot blocked).

## Open questions for user
None.
