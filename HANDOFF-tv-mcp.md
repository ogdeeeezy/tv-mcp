# HANDOFF-tv-mcp

> Fork at `ogdeeeezy/tv-mcp` (split 2026-05-11 from `~/tradibos/`).

## Current state

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

**Before `npm test`: ensure no other Claude/CDP process is hitting Chrome.** A background test run during Session 11 reported 60 failures starting with an 18-minute `chart_set_symbol` timeout — caused by CDP contention with live `ui_evaluate` probes, NOT real regressions. On a quiet Chrome, expect ~160/160. Anything in the 80-100 pass range means Chrome is busy; close other lanes and retry.

Two open follow-ups, both safe to defer:

1. **`openScript` rebinding gap.** `openScript` currently does `fetch + setValue` only — it overwrites the editor buffer but does NOT update the title-button binding to the new slot. A subsequent `pine_save` then writes via `save.script` to whatever was previously bound. The 2026-06-05 incident shape, masked because callers always pass `name` to `pine_save` (which routes through the unbound path). Real fix needs TV's internal "open script by id" routine — discoverable by live probing the "Open Script" UI click handler or `chartWidgetCollection.activeChartWidget().model().activeStrategySource()` prototype. **Needs live Chrome session** — not unit-testable.

2. **Capture the real delete endpoint.** `POST /pine-facade/delete/<urlencoded-id>` returns `401 "not an owner"` (probably wrong shape). `DELETE` method is CORS-blocked from page context. `ui_evaluate` doesn't await Promises so async discovery needs a stash-on-`window`-and-poll pattern. **30-second job with Chrome DevTools:** delete one script via TV's UI, copy the actual request from Network tab, wire into a new `pine_delete` tool. Until then, 5 stale probes remain visible in `pine_list_scripts` — user clears via TV UI when convenient.

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
- `src/core/pine.js` — Fix 1+2 fully landed in `e7b4a2f`. Next change-of-interest: `openScript` rebinding routine.
- `src/core/pin_registry.js` — v2 with pine_editor singleton (Fix 3).
- `src/tools/pine.js` — claim/release/status tools at the bottom.
- `tests/pin_registry.test.js` — 12 pine_editor cases.
- `SPEC-pine-safe-create.md`, `INCIDENT-pine-overwrite-2026-06-05.md`.

## Related repos
- `~/tradibos/`, `~/lib/schwab-market-data/` + `/root/schwab-market-data/` on H2, `~/tradibos-nautilus/` on H2 (Pine slot blocked).

## Open questions for user
None.
