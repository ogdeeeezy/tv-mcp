# INSIGHTS-tv-mcp

Non-obvious learnings from working on tv-mcp. Project-specific. Cross-project lessons live in `~/.claude/knowledge/`.

## TV pine-facade lives on its own subdomain — `www.tradingview.com/pine-facade/...` returns 401

**Captured:** 2026-06-10 (Session 13)

Every TV "/pine-facade/" endpoint is hosted at `https://pine-facade.tradingview.com/pine-facade/...`, NOT `https://www.tradingview.com/pine-facade/...`. The www host either 401s or routes to a totally different auth surface. Multiple prior probe sessions chased "permissions" / "not an owner" errors that were entirely a wrong-host artifact — cookies and origin headers differ between subdomains.

When sniffing TV's internal API via the fetch interceptor, **always log the full URL including hostname** — never assume the path implies the host. A request like `POST /pine-facade/delete/<id>` could be relative-to-page (www) or absolute-to-subdomain; only the trace tells you.

## TV's save endpoints follow a `/save/new` vs `/save/next/<id>` sibling pattern

**Captured:** 2026-06-10 (Session 13)

The pine-facade save API has two endpoints that look like siblings but mean very different things:

- `POST /pine-facade/save/new?name=<n>&allow_overwrite=false` — create a fresh slot. FormData `source`. 409s on name collision when `allow_overwrite=false`.
- `POST /pine-facade/save/next/<urlencoded-scriptIdPart>?allow_create_new=false&name=<n>` — update existing slot in place. FormData `source`. Refuses if id missing when `allow_create_new=false`.

The `next` in the URL refers to the *next version* of the existing script, not a "next-id" pagination thing. Mental model: "save the next version of this id". Both endpoints share the FormData `source` body shape; the distinguishing args are URL-level (id in path, safety flag in query).

## Capturing a TV save endpoint requires a bound editor — `save.script` on unbound = zero fetches

**Captured:** 2026-06-10 (Session 13)

The first capture attempt (Session 12) tried to trigger `save.script` on an editor unbound by `pine_open`. Zero pine-facade fetches were sniffed. The `isSaveEnabled` context-key gate noops the command on unbound state — the save URL is never reached.

The working capture method requires TV's own UI to establish a *real binding*: click the title button → "Open script…" → pick one. The title button then shows the script's actual name (not "Untitled script"), and `isSaveEnabled` flips through the bound path. Only THEN does Cmd+S fire the save URL we can intercept.

This means the bind-handler that TV's UI uses (inside the title-button click chain) is a closure we never extracted statically — it's the only path that produces the bound editor state we need for sniffing. Capture method documented in `PROGRESS-tv-mcp.md` Session 13 + handoff trace.

## Loud duplication > silent overwrite when the proper fix needs more discovery

**Captured:** 2026-06-10 (Session 12)

The `openScript` rebinding gap (Session 12) had two possible fixes:

1. **Proper fix** — discover TV's internal "open script by id" routine and rebind the editor to the new slot, so subsequent `pine_save` writes through `save.script` to the correct cloud slot. Requires capturing the per-id save endpoint (manual TV UI step + fetch sniffing).
2. **Defensive fix** — run `new_indicator` action before `setValue` to leave the editor in an unbound "Untitled script" state holding the loaded source. Subsequent `pine_save({name})` creates a duplicate slot rather than silently overwriting the prior binding.

We shipped #2 because the discovery cost for #1 wasn't justified in-session. The trade-off is intentional: the failure mode becomes **visible** (user sees two slots with the same name in their TV library and knows something happened) rather than **silent** (a different unrelated script gets overwritten). Visible failures are recoverable; silent ones aren't.

The proper fix is logged as HANDOFF follow-up #1 with a precise reproduction recipe so a future session can finish it. The lesson generalizes: when you can't ship the perfect fix in this session, ship the one that makes failures observable.

## Pine editor title-button menu structure (TV 2026-06)

**Captured:** 2026-06-10 (Session 12)

Clicking `[data-qa-id="pine-script-title-button"]` opens a 7-item menu. Items (extracted from React fiber traversal of menu items):

| Label | Wires to | Notes |
|---|---|---|
| Save script ⌘S | save.script command | Gated on `isSaveEnabled` context key |
| Make a copy… | (closure) | Likely POSTs to pine-facade/save/new |
| Rename… | (closure) | Probably hits a rename endpoint |
| Version history… | (closure) | Reads `/pine-facade/get/{id}/{version}` |
| Move script to bottom | (closure) | UI reorder, no server call |
| Create new | `de()` → `new_indicator` action | Same path `pine_new` uses |
| Open script… ⌘O | (closure → submenu/picker) | The bind handler we wanted to capture |

Note: menu items have `aria-haspopup`, `aria-expanded`, `aria-controls` — they're trigger buttons themselves. The actual handlers are closure-captured (e.g., `(...e)=>{i?.(...e),"doNotClose"!==a&&n(!0,...)}`) so static fiber inspection only gets the wrapper. Reaching the inner `i`/`de` requires either clicking-and-inspecting the resulting UI or extracting from the component that defines them in scope.

## save.script on unbound editor is a true silent no-op

**Captured:** 2026-06-10 (Session 12)

State at probe: `title="Untitled script"`, `isSaveEnabled=true`, model URI contains `placement%3Ddialog`. Triggered `editor.getSupportedActions().find(a => a.id === 'vs.editor.ICodeEditor:1:save.script').run()` with a fetch sniffer patching `window.fetch` to log all pine-facade calls.

Result: **zero fetches, no dialog opened, no state change**. The `isSaveEnabled + placement%3Ddialog` HANDOFF gotcha holds — the action runs (no throw) but TV's internal gating prevents any side effect. This confirms the unbound state IS the safety fuse: even if `save.script` is called erroneously on an unbound editor (e.g., due to user shortcut press), nothing harmful happens.

Practical implication for `pine_save`: the bound-vs-unbound dispatch in `pine.js:save()` is correct — for unbound editors it requires explicit `name` and POSTs directly to `/save/new`, never relying on `save.script`. For bound editors it can safely invoke `save.script` knowing it'll be no-op'd if conditions aren't right.

## Chrome 136+ blocks `--remote-debugging-port` on the default user-data-dir

**Captured:** 2026-05-15

**Symptom:** `chrome_launch` returns `launched_but_not_responsive`. Chrome process is alive with `--remote-debugging-port=9222` in its argv. `lsof -i :9222` returns nothing. `chrome_health` says `fetch failed`. `curl http://localhost:9222/json/version` hangs.

**Root cause:** Starting in Chrome 136 (Apr–May 2025), Google added a security check that refuses to bind the debug port when the resolved user-data-dir is the OS-default location (`~/Library/Application Support/Google/Chrome/` on macOS, equivalent on other OSes). This was added in response to malware (Cookie Reaper, Rilide, ChromeLoader) that used DevTools-attach against logged-in default profiles to exfiltrate session cookies. The check is **path-based**, not flag-presence-based — passing `--user-data-dir=<default-path>` explicitly does not bypass it.

**Fix:** Launch with `--user-data-dir=<any non-default path>`. The MCP's `chrome_launch` accepts `user_data_dir` as a parameter.

**Durable profile for this machine:** `~/Library/Application Support/tv-mcp-chrome`, signed in as `withthechefboy@gmail.com`. Chrome Sync brings extensions and bookmarks; TradingView login is local to this profile (TV isn't on Google sync).

**Time wasted before identifying:** ~30 minutes across three wrong-root-cause guesses (singleton-attach, slow cold-start, explicit-default-path bypass). Documented in `CLAUDE.md` "Chrome setup" → "What NOT to waste time on" so future sessions skip the rabbit hole.

## Tab title formats drift; the parser must handle both shapes

**Captured:** 2026-05-15

TradingView's tab titles take two shapes in the wild:

| Format | Example |
|---|---|
| Parenthesized | `GOLD FUTURES (GC1!), 4h Chart Online — TradingView` |
| Leading-symbol | `GC1! 4,557.2 ▼ −2.73% gold` |

A single regex matching only one format silently returns `null` symbol, which makes `tab_pin symbol=<X>` no-op without an error. The parser was extracted to `parseSymbolFromTitle()` and exported so new title formats can be added with a single regex + test rather than touching `picker()`. Cheap fallbacks: `tab_pin title=` or `tab_pin url=` both work on either format.

## Pin state ≠ registry state — internal reconnects must not re-claim

**Captured:** 2026-05-15

`connection.js` distinguishes two layers:

- **In-process pin** (`setPin`/`clearPin`): which tab this MCP routes CDP calls to. Used by transient reconnect logic when CDP drops mid-call.
- **Cross-instance claim** (`claimAndPin`/`releaseAndUnpin`): which session "owns" this tab globally. Hits the file-backed registry at `~/.tv-mcp-registry.json`.

A reconnect should *only* re-set the in-process pin — claiming on every reconnect would inflate the claim's `claimedAt` timestamp and confuse other sessions reading the registry. The tools (`tab_pin`/`tab_unpin`) use the registry-aware path; bare `setPin`/`clearPin` are for internal-only code paths.

## Registry coordination is tab-scoped, not lane-scoped

**Captured:** 2026-05-15

The MCP registers six identical lanes (`tv-mcp-a..f`). Each Claude session spawns its own copy of these six processes. So naively, a "claim" could be scoped to the lane — but that's wrong: two lanes (in the same session OR different sessions) pinned to the same Chrome tab will race against each other on every CDP call, because Chrome only sees one CDP client per target.

The registry therefore locks at the **target ID** (Chrome tab id), not the lane. Lane is recorded as a hint/telemetry field on the claim entry but isn't part of the key. Concrete consequence: session A's lane `a` and session B's lane `a` can both run simultaneously *as long as they pin to different tabs*. They share the same lane name; they don't share the same tab.

## npm publish is overhead, not value, for a small Claude-Code tool

**Captured:** 2026-05-18

**The thing we almost did:** Published `tv-mcp` to npm so non-technical friends could `npm install -g tv-mcp` instead of `git clone`. Hit the friction stack — npm 2FA required for publish (Chrome's passkey flow only handles browser logins, not CLI), then granular access tokens with bypass-2FA, then the chicken-and-egg of token-needs-package-but-package-needs-token (workaround: "All packages" permission on first publish).

**What we realized just before publishing:** The clone path was already documented end-to-end:
```bash
git clone https://github.com/ogdeeeezy/tv-mcp.git
cd tv-mcp
npm install
npm run setup
```
That's the same number of steps as the npm path, and the `tv setup` command does all the heavy lifting either way. The npm advantage was almost entirely "global `tv` CLI on PATH" — easily replaced by `npm link` from the clone dir if anyone wants it.

**The cost npm would have added:**
- Ongoing token rotation (typically 30-90 days)
- Semver discipline tied to a public contract — breaking changes need major version bumps
- Permanent reservation of version numbers (can't reuse `1.0.0` even after unpublish past 72h)
- Account-level 2FA setup work for every machine that publishes
- One more login + recovery codes + token vault to manage

**The principle:** For a small, single-purpose tool that's already easy to install from source, npm publish is overhead, not value. The honest test is "what does npm give us that a clean README quickstart doesn't?" — for this project, the answer was "a global binary, replaceable with `npm link`." Not worth the rest of the package.

**When npm WOULD be worth it (for next-time reference):**
- The tool is a library being imported into other projects (`import { foo } from 'tv-mcp'`)
- It needs to be available via `npx tv-mcp-something` for one-shot use without cloning
- Multiple machines/CI need to install it programmatically and `git clone` is too heavy
- The tool has serious downstream dependents that would benefit from semver

For a single-user CLI + MCP server shared with technical-enough friends, none of those apply.

## pin_registry composes cleanly for non-tab resource claims

**Captured:** 2026-06-05

Fix 3 added a global `pine_editor` slot to `~/.tv-mcp-registry.json` without introducing any new infrastructure — same lock file, same atomic-write, same exit-handler path, same `isAlive(pid)` prune. The shape went from `{pins: {targetId → entry}}` to `{pins: {...}, pine_editor: entry | null}` with a v1→v2 backwards-compatible read.

The pattern that made this cheap: the existing `claim()` function was purely targetId-scoped (tab pins), but the lock/prune/atomic-write machinery was generic. Splitting "what to claim" (caller's domain knowledge) from "how to claim" (registry's mechanism) meant adding a sibling singleton field cost ~80 lines of mirror-pattern code and zero new locking.

**When this generalizes:** any future "one of N parallel MCP processes can hold global resource X at a time" need can follow the same template. Examples that would fit: a singleton "live-replay session" claim (only one process can run replay_start at a time without confusing TV's replay state), a singleton "alert-dialog open" claim (only one process can be mid-alert-create wizard).

**What would change the calculus:** if a future claim needs richer semantics (queue, fairness, timeouts), the in-line append pattern stops scaling and the registry should split into a dispatch layer + per-claim modules.

## MCP process freeze means safety nets ship blind in the same session

**Captured:** 2026-06-05

The six `tv-mcp-a..f` processes spawn at Claude Code session start and freeze on the code that exists at that moment. This is documented as a gotcha for editing tools mid-session, but it has a subtler consequence: **a safety-belt fix can be merged + committed + tested at the unit level but NOT verified live** in the same session it was written. The running MCP processes still have the pre-fix code; the new `pine_claim` tool is unreachable until Claude Code restarts.

What this means for planning:
- Don't try to "test the new code live" before restart. It will appear to work because the running code is unchanged — false-pass.
- The unit-test suite must be the proof point for "this code is correct," not live integration. Integration tests come after a restart cycle.
- Plan safety belts and behavior fixes in the same commit so a single restart cycle proves both. Don't ship a safety belt and a behavior fix in separate restart cycles unless one strictly depends on the other.

This bit Session 8: Fix 3 is in code but the running process can't surface the new tools — the next instance must restart to verify.

## TaskUpdate description-rewrite preserves ephemeral state across restart

**Captured:** 2026-06-05

When live state exists that dies on Claude Code restart (a Chrome tab pin, an injected DOM interceptor, a CDP connection), `TaskUpdate` with a rewritten description is a clean way to write down "what is currently true but will be gone" so the next instance can re-establish it.

Session 8 example: lane `tv-mcp-e` was pinned to chart `YKaDEilf`, and `window.__pineProbe.calls` had a fetch+XHR interceptor installed. Both die when Claude Code restarts. The pin re-claim is trivial; re-installing the interceptor verbatim is tedious unless the new instance knows the exact snippet. The task description got: `PIN ALREADY DONE: lane tv-mcp-e was pinned to chart_id YKaDEilf (COMEX:GC1! 1h) and a fetch+XHR interceptor was installed in that tab capturing pine-facade traffic into window.__pineProbe.calls. Both die on Claude Code restart — next instance starts fresh. Step left undone: trigger TV's "New script" UI action and inspect captured POST request shape.`

Tasks persist across instances because they live in the harness's storage, not the conversation. PROGRESS docs and HANDOFFs are the right place for "state we want to keep around" — but for "ephemeral state that has a narrow re-establish window," a task description is faster, more granular, and naturally tied to the work that needs it.

## The Pine "safety fuse" is `isSaveEnabled`, not the title button

**Captured:** 2026-06-09

When `pine_new` runs the Monaco `new_indicator` action, the editor's model swaps to one whose URI carries URL-encoded `?placement%3Ddialog` and whose `isSaveEnabled` context key goes false. That `isSaveEnabled=false` is what stops `save.script` from overwriting a previously-bound slot — not the title-button DOM. The title button is a *secondary, lagging* signal.

Three implications:

- Anything sniffing the model URI for dialog state must match `placement%3Ddialog` (URL-encoded), not `placement=dialog`. The naive comparison silently returns false negatives.
- There is only ONE Monaco editor instance on the page at any moment — `env.editor.getEditors()` returns length 1. The "dialog vs main" distinction is model state on the same instance, not a separate instance. Multiple `.monaco-editor.pine-editor-monaco` DOM nodes can coexist as stale leftovers from previous mounts, which earlier debugging mistook for live separate editors.
- Title-button DOM (`[data-qa-id="pine-script-title-button"]`) is fine for human-readable status, but for decisions that gate writes, read `isSaveEnabled` off the editor's `_contextKeyService`. The title button can lag the editor state, and `document.querySelector` can pick up the wrong node if both popout-dialog and main-pane wrappers exist.

The Session 11 verification (commit `e7b4a2f`) confirmed this by ICC rv3 — Spec Viz remaining at v11.0 throughout a successful `pine_new → pine_set_source → pine_save(name=...)` cycle on a different tab. The fuse held exactly because the new model had `isSaveEnabled=false` and the saved-as-new path routed through `pine-facade/save/new` with `allow_overwrite=false`, never invoking `save.script` on the still-bound foreign slot.

## bottomWidgetBar API surface (2026-06)

**Captured:** 2026-06-09

TV removed `bottomWidgetBar.hideWidget(name)` somewhere between the prior e2e capture and Chrome 149. Probing the live object showed:

- **Public own functions:** `open`, `close`, `hide`, `show`, `toggleMaximize`, `toggleMinimize`.
- **Public prototype functions (relevant ones):** `showWidget(name)`, `activateWidget(name)`, `toggleWidget(name)`, `getWidgetByName(name)`, `isVisible()`, `activeWidget()`, `activateScriptEditorTab()`, `setWidgetAvailability(name, available)`.
- **Private (underscored) functions:** `_hideWidget(name)`, `_showWidget(name)`, etc. — implementation details, don't depend on them.

The migration path for code that used to call `bottomWidgetBar.hideWidget('pine-editor')`:
- For "close whatever is active": `bottomWidgetBar.close()` (parameterless).
- For "toggle a specific widget": `bottomWidgetBar.toggleWidget('pine-editor')` — preserved.
- For "show a specific widget": `bottomWidgetBar.showWidget('pine-editor')` — preserved.

There is no straight equivalent of `hideWidget('pine-editor')` that targets a specific widget without affecting active state. `close()` is the closest semantic match for the e2e test case ("open → close again to verify toggling works"). If precise per-widget hiding is ever needed by a tool, `toggleWidget(name)` after checking `activeWidgetName()` is the safest pattern.

Lesson: when TV strips a public method, look at the new own-methods (`close`, `hide`) before reaching for the underscored private siblings. Underscored methods are internal and can be renamed without TV considering it a breaking change.
