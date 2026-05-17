# INSIGHTS-tv-mcp

Non-obvious learnings from working on tv-mcp. Project-specific. Cross-project lessons live in `~/.claude/knowledge/`.

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
