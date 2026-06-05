# INCIDENT: pine_new silently overwrites the previously-loaded script

**Date**: 2026-06-05
**Severity**: HIGH (data loss; recovered via pine-facade versioned-get fallback)
**Affected tools**: `pine_new`, `pine_save`, `pine_smart_compile`
**Affected user**: `withthechefboy@gmail.com` on this machine's `~/Library/Application Support/tv-mcp-chrome` profile

---

## What happened

A Claude Code session (tradibos-nautilus instance) called this sequence to inject a Darvas Pine strategy for three-way backtest parity:

```
pine_new(type="strategy")
pine_set_source(source="<Darvas strategy code>")
pine_smart_compile()
```

Expected: a new Pine Script slot is created in the user's TradingView account, my Darvas source is saved into it, and the compiled study attaches to the chart.

Actual: TV script slot `USER;9cab858fa0874c77a4859d3cd886779e` — which held the user's **W-Bottom v5 PROP TUNED** strategy (97 lines, v5.0) — was version-bumped to v7.0 with **the entire body replaced by the Darvas code** (70 lines) and title renamed. The chart study `iwaAdh` was likewise replaced. The next `pine_list_scripts` showed:

| Before | After |
|---|---|
| name: "double bottoms w/ regime" | name: "double bottoms w/ regime" (unchanged) |
| title: "W-Bottom v5 PROP TUNED" | title: "Darvas v1 clone (tradibos-nautilus parity)" |
| version: 5.0 | version: 7.0 |
| modified: 1780567112 | modified: 1780656502 |

## Root cause (src/core/pine.js:508)

```javascript
export async function newScript({ type }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const typeMap = { indicator: 'indicator', strategy: 'strategy', library: 'library' };
  const templates = {
    indicator: '//@version=6\nindicator("My script")\nplot(close)',
    strategy: '//@version=6\nstrategy("My strategy", overlay=true)\n',
    library: '//@version=6\n// @description TODO: add library description here\nlibrary("MyLibrary")\n',
  };
  const template = templates[type] || templates.indicator;

  const escaped = JSON.stringify(template);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco editor not found. Ensure Pine Editor is open.');

  return { success: true, type, action: 'new_script_created', template: typeMap[type] };
}
```

**`pine_new` does NOT create a new script. It only calls `m.editor.setValue(template)`**, which replaces the Monaco editor buffer text. The editor instance remains bound to whichever script slot was last opened (the one whose Pine source was loaded into the editor — either via the user's last UI action or `pine_open`).

When `pine_save` (or `pine_smart_compile`, which clicks Save) subsequently fires, it saves the current editor buffer to the bound slot, **silently overwriting it**.

The return value `{action: 'new_script_created'}` is a lie — no new script exists. The function name is dangerously misleading.

## Auxiliary discovery: `pine_save` silently no-ops when editor not focused

`core.save()` (src/core/pine.js:347) dispatches `Ctrl+S` via CDP `Input.dispatchKeyEvent`. The keystroke lands on whatever currently has DOM focus. After `pine_set_source` (which only mutates the Monaco buffer via `editor.setValue`) the editor textarea is typically NOT focused — so the Ctrl+S dispatch hits the document body, which has no save handler, and the save is silently dropped.

The function still returns `{success: true, action: 'Ctrl+S_dispatched'}` — also misleading. There's no verification that the save actually persisted.

## Evidence trail (this session)

1. **Confirmed slot replacement**: `pine_list_scripts` before vs after shows the same `scriptIdPart` with body and title replaced (see "What happened" table).

2. **Confirmed version history is server-side intact**: `fetch('https://pine-facade.tradingview.com/pine-facade/get/{id}/{version}')` works for arbitrary versions:
   - v5.0 = "W-Bottom v5 PROP TUNED" (97 lines, 4782 bytes) ✓
   - v6.0 = "W-Bottom v5.1A Confirm" (73 lines)
   - v7.0 = "Darvas v1 clone (tradibos-nautilus parity)" (70 lines, the overwrite)
   - Older versions (1.0-4.0) still queryable

3. **Confirmed Ctrl+S no-op**: dispatched `pine_save` after `pine_set_source` of the recovered v5.0 source — pine-facade `/get/.../last` still returned v7.0 (Darvas). The save was silently dropped because the Monaco textarea was unfocused.

4. **Confirmed Monaco action save works**: `editor.getSupportedActions().find(a => a.id === 'vs.editor.ICodeEditor:1:save.script').run()` triggered TV's custom save command — pine-facade `/get/.../last` then returned v8.0 = byte-identical to v5.0 PROP TUNED. Recovery complete.

## Recovery used

```javascript
// 1. Fetch original source via pine-facade versioned-get
fetch('https://pine-facade.tradingview.com/pine-facade/get/USER%3B9cab.../5.0', {credentials: 'include'})
  .then(r => r.json())
  .then(j => window.__src5 = {source: j.source});

// 2. Inject into editor + focus
m.editor.setValue(window.__src5.source);
m.editor.focus();

// 3. Trigger TV's custom save via Monaco action (NOT Ctrl+S dispatch)
m.editor.getSupportedActions()
  .find(a => /save\.script/i.test(a.id))
  .run();

// 4. Verify via pine-facade
fetch('https://pine-facade.tradingview.com/pine-facade/get/USER%3B9cab.../last', ...)
// → version 8.0, title "W-Bottom v5 PROP TUNED", bytes 4782 ✓
```

## Why this took so long to surface

- `pine_new` has been in the codebase since the initial fork. The function's name and return value implied correctness; no test verified that a NEW slot was actually created server-side.
- Most prior use was probably for one-shot inject-and-discard work where the user wasn't preserving the displaced script.
- The Pine editor's "currently-loaded script" state isn't visible in `pine_list_scripts` output — there's no concept of "active slot" exposed, so the silent rebinding is invisible.

## Scope of any historical damage

Unknown without an audit. Any Claude session that called `pine_new` + `pine_set_source` + Save (whether via `pine_save`, `pine_smart_compile`, or auto-save from another tool) since the fork has potentially overwritten the user's last-loaded script. The pine-facade versioned-get endpoint makes recovery feasible for ANY past incident, provided the user knows which slot was clobbered and at what version.
