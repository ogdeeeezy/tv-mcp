# PROGRESS-tv-mcp

> Sessions 1-11 archived → `docs/archive/archive-progress-tv-mcp.md`

---

## Session 14: 2026-06-10 — pine_save({scriptIdPart}) smoke-tested PASS

### Done
- **In-place save end-to-end verified through the MCP** on a fresh `tv-mcp-d` lane post-restart. Created disposable slot via `pine_new(name="smoke-test-pine-save-2026-06-10")` → `USER;a4c2e20eb8754638ba6e2d609546903a` v1.0. `pine_open(name=...)` → loaded source, `bound: false`. `pine_set_source(<modified with marker>)` → 7 lines. `pine_save({scriptIdPart})` returned `action: "saved_to_existing"`, `version: "2.0"`, `verified: true` (pine-facade /get/last cross-check). `pine_list_scripts` confirmed: slot id unchanged, name preserved, title picked up from new `indicator()` declaration, modified timestamp current, no duplicate entry. Slot then `pine_delete`d cleanly (verified absent on re-list).
- **Verdict:** the per-id overwrite path is the in-place edit workflow it was designed to be. Caller-provided `scriptIdPart` wins, no silent dupes, version bumps correctly.
- **Housekeeping subnode created** at `~/obsidian/agenting/projects/tradingview-mcp/tv-mcp-housekeeping.md` — parked 4 non-blocking items (replay_stop drift, tv_launch path drift, bottomWidgetBar.hideWidget removal, ICC rv1 cosmetic typo) with trigger conditions for when to pull each out. Linked from parent project node.
- **Docs committed and pushed** (`e98a42b`).

### Decisions
- None. This was a verification + structural-audit run, no code changes.

### Next
- None outstanding. Project at clean rest state. All HANDOFF follow-ups closed. Other instances can resume trading strategy work on this substrate.

---

## Session 13: 2026-06-10 — openScript smoke-tested, pine_delete shipped

### Done
- **openScript fix smoke-tested PASS** (`e0e1cc9`). `pine_open(name="tvmcp_probe_1780835557228")` → `bound: false`, title "Untitled script". Follow-up save: `pine_save({name=<same>})` returned **HTTP 409 "Script already exists"** — TV refuses duplicate names server-side at `/pine-facade/save/new?allow_overwrite=false`. Louder failure than the handoff predicted (no silent dupe), library stays clean.
- **Delete endpoint captured.** Installed fetch interceptor on the gold-baby tab, user deleted 3 stale probe scripts via TV's UI, log captured: `POST https://pine-facade.tradingview.com/pine-facade/delete/<urlencoded-id>` with no body. Prior 401 probe failed because it hit `www.tradingview.com` (wrong subdomain). DELETE method stays CORS-blocked; POST is the verb.
- **`pine_delete` tool wired and shipped** (`6e4513b`). Accepts `{name?, scriptIdPart?}`. `scriptIdPart` wins on conflict. Name lookup case-insensitive, refuses on ambiguous match with `PINE_DELETE_AMBIGUOUS` + `matches[]`. Requires `pine_claim`. Verifies by re-listing post-delete (same pattern TV's UI uses — observed re-list after each delete in capture trace).
- **10 unit tests** for `selectDeleteTarget` (`tests/pine_delete.test.js`); full unit suite 104/104.
- **Library cleanup side-effect:** 4 stale probe scripts deleted by user during capture (3 directly + restart-test via hard refresh after the first attempt was silently refused).

### Decisions
- **scriptIdPart wins when both args provided.** Explicit ID is unambiguous; name can collide with the duplicate-slot artifacts that `pine_open` + `pine_save` could create.
- **Required pine_claim despite delete not touching editor state.** Cloud-side destructive mutation — same threat model as `pine_save` (account-global resource); the singleton claim is the right gate.

### Next
- **Restart Claude Code** so the six `tv-mcp-*` lanes pick up `6e4513b` + `d1a52a2`.
- **End-to-end smoke test** of the new in-place save: `pine_claim → pine_open(name=<disposable>) → pine_set_source → pine_save({scriptIdPart}) → pine_get_source` to verify version bumps + source matches.

### Bonus — in-place save endpoint captured + wired (`d1a52a2`)
- Same fetch-interceptor method as the delete capture, but with the user opening `ICC rv1 Strategy` via TV's UI (title button → "Open script…") to get a bound editor, then Cmd+S after a one-char dirty.
- Endpoint: `POST /pine-facade/save/next/<urlencoded-id>?allow_create_new=false&name=<urlencoded-name>` with FormData `source`. `allow_create_new=false` is the safety knob.
- `pine_save` now accepts `scriptIdPart`; when provided, routes to /save/next/<id> (wins over editor binding). Three paths: (1) scriptIdPart → in-place, (2) bound + no id → Monaco save.script, (3) unbound + name → /save/new.
- Unlocks: `pine_open → edit → pine_save({scriptIdPart})` as the in-place edit workflow.
- Side-effect: `ICC rv1 Strategy` now has a stray space in its title comment (`I CC rv2 Strategy` instead of `ICC rv2 Strategy`) from the dirty-buffer trigger. Cosmetic — user can edit back via TV UI when convenient.

---

## Session 12: 2026-06-10 — openScript rebinding gap closed

### Done
- **`openScript` rebinding gap closed** (uncommitted on disk). Added `new_indicator` Monaco action invocation before `setValue` in `src/core/pine.js:openScript()`, mirroring the Fix 1+2 pattern in `newScript()`. Editor lands as unbound draft holding the loaded source. Tool description in `src/tools/pine.js` updated to reflect the new "duplicates loudly instead of overwriting silently" contract. 94/94 unit tests still pass.
- **Discovery: title-button menu has the open-script chain.** Live-probed the Pine editor title button (`[data-qa-id="pine-script-title-button"]`) — its menu lists "Save script", "Make a copy…", "Rename…", "Version history…", "Move script to bottom", "Create new", "Open script… ⌘O". `Create new` wires to `de()` (the `new_indicator` Monaco action — the same path `pine_new` uses). `Open script…` opens a submenu/picker dialog whose inner click handler is the actual editor-bind routine. Couldn't extract the bind handler statically (closure-captured), and didn't pursue further — the `new_indicator` pre-unbind path is a complete safety fix and ships value without it.
- **save.script on unbound editor confirmed silent no-op** (sniffer captured zero pine-facade fetches, no dialog). The HANDOFF gotcha holds: `isSaveEnabled + placement%3Ddialog` is the real safety fuse. The data-loss path requires a binding established via TV's UI — which `openScript` no longer leaves intact.

### Decisions
- **Did not pursue the per-id overwrite endpoint** in this session. Capturing it requires a bound editor (manual TV UI click) and the user was frustrated with how long the probing took. Logged as follow-up #1 in HANDOFF with the exact reproduction recipe.
- **Did not run e2e tests** — they would collide with the pinned `gold` tab via CDP. Unit suite (94 tests) covers pin_registry + pine_analyze + tab_picker + setup; the pine.js change is JS-template strings injected via CDP and isn't directly unit-testable.

### Next
- Commit `feat(pine): openScript runs new_indicator before setValue (closes rebinding gap)` and push.
- Capture per-id overwrite endpoint when convenient — HANDOFF #1 has the recipe.
- Capture delete endpoint via DevTools — HANDOFF #2.
