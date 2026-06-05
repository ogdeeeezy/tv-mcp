# SPEC: Pine safe-create + reliable save (fix for pine-overwrite incident)

**Status**: Draft
**Drives**: `INCIDENT-pine-overwrite-2026-06-05.md`
**Files to touch**: `src/core/pine.js`, `src/tools/pine.js`, possibly `src/connection.js`
**Estimated effort**: 1 focused session (3–5 hours including tests and a live multi-instance verification)

---

## Goals

1. `pine_new` MUST create a new server-side script slot and bind the editor to it. Never overwrites an existing slot.
2. `pine_save` MUST verify that the persist actually happened, not just that a keystroke was dispatched.
3. Multi-instance dev (two Claude sessions touching Pine simultaneously) MUST be safe: either fully serialized at the editor level, or each instance gets its own isolated script-edit slot.
4. Backwards-compatible tool names where possible; deprecate misleading behavior loudly.

## Non-goals

- Out-of-band Pine source storage (filesystem-backed source-of-truth). The TV pine-facade is authoritative; we just need to interact with it correctly.
- Changes to how compiled studies are attached to the chart. That path works.

---

## Fix 1 — `pine_new` actually creates

### Investigation needed first

Find the TV pine-facade endpoint(s) for creating a new script. Likely candidates:

- `POST https://pine-facade.tradingview.com/pine-facade/save/` (or `/create/`) with body containing `source`, `name`/`scriptName`, and possibly `version: '1.0'`
- Inspect what the **"New" button in the Pine Editor UI** posts when clicked. Use Chrome DevTools Network tab while the tv-mcp Chrome is running.
- TV's pine-facade also has `GET /list/?filter=saved` (we use this in `listScripts`); the corresponding POST/PUT will follow a similar pattern.

The `openScript` flow shows the read shape:
```js
fetch('https://pine-facade.tradingview.com/pine-facade/get/' + id + '/' + ver, {credentials: 'include'})
```

The write shape should be discoverable via DevTools Network tab during a manual "Save As" or "New".

### New behavior of `pine_new`

```js
export async function newScript({ type, name }) {
  // 1. Compute unique name if not provided
  const slotName = name || `tv-mcp-${type}-${Date.now()}`;

  // 2. POST to pine-facade create endpoint (TBD exact URL) — returns new scriptIdPart
  const newId = await createPineScript({ name: slotName, source: templates[type] });

  // 3. Bind the editor to the new slot via the same mechanism openScript uses
  await openScript({ name: slotName });   // ← rebinds editor to new slot

  // 4. Now editor.setValue(template) is a no-op safety
  return { success: true, type, scriptIdPart: newId, name: slotName, action: 'new_script_created' };
}
```

### Acceptance criteria

- Test 1: Call `pine_new(type='strategy')` twice in succession. After each, `pine_list_scripts` returns one MORE entry than before.
- Test 2: After `pine_new`, the editor's bound script (verifiable via `pine_get_source` + cross-check with the new `scriptIdPart`) is the new one.
- Test 3: Subsequent `pine_set_source` + `pine_save` writes to the new slot, never to a pre-existing slot.

## Fix 2 — Reliable `pine_save` with verification

### Two-part change

**A. Focus the editor before dispatching the save.** Either:
- Call `m.editor.focus()` from inside the JS evaluated for the save, OR
- Use Monaco's command action directly (preferred, no focus dependency):

```js
const SAVE_VIA_MONACO_ACTION = `
  (function() {
    var m = ${FIND_MONACO};
    if (!m) return {success: false, error: 'no editor'};
    var actions = m.editor.getSupportedActions();
    var saveAction = actions.find(function(a) { return /save\\.script/i.test(a.id); });
    if (!saveAction) return {success: false, error: 'save action not registered'};
    var p = saveAction.run();
    return {success: true, actionId: saveAction.id, returnedPromise: typeof (p && p.then) === 'function'};
  })()
`;
```

This bypasses Ctrl+S and the focus dependency entirely. `vs.editor.ICodeEditor:1:save.script` is TV's custom action and was confirmed working in the recovery flow on 2026-06-05.

**B. Verify the save actually persisted.** After firing the save action, poll pine-facade:

```js
async function verifySaved(scriptIdPart, expectedSource, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const head = await evaluateAsync(`
      fetch('https://pine-facade.tradingview.com/pine-facade/get/' +
            encodeURIComponent('${scriptIdPart}') + '/last',
            {credentials: 'include'}).then(r => r.json())
    `);
    if (head?.source === expectedSource) return {ok: true, version: head.version};
    await new Promise(r => setTimeout(r, 200));
  }
  return {ok: false, reason: 'save did not propagate to pine-facade within ' + timeoutMs + 'ms'};
}
```

### Acceptance criteria

- Test 1: After `pine_set_source(X)` + `pine_save`, `pine_get_source` AND pine-facade `/get/{id}/last` both return X.
- Test 2: If save fails (e.g., editor not in a writable state), `pine_save` returns `{success: false}` with a real reason, not `{success: true, action: 'Ctrl+S_dispatched'}`.

## Fix 3 — Multi-instance safety

### The problem

The Pine Editor in the TV web app is a singleton DOM element. Two Claude instances connected to the same Chrome can both call `pine_set_source` and race on every save. There's no editor-level locking.

### Three layers of mitigation

**Layer A: cross-instance Pine-editor claim (analogous to tab_pin registry)**

Extend `~/.tv-mcp-registry.json` to track Pine editor ownership:

```json
{
  "tabs": { ... },
  "pine_editor": {
    "owner_pid": 12345,
    "owner_lane": "tv-mcp-a",
    "claimed_at": "2026-06-05T22:14:00Z",
    "scriptIdPart": "USER;abc..."
  }
}
```

New tools:
- `pine_claim` — claim the Pine editor for the current lane. Returns `{conflict: true, owner: ...}` if another live PID holds it.
- `pine_release` — release the claim.
- `pine_set_source`, `pine_new`, `pine_save`, `pine_smart_compile` all REQUIRE a claim. Calling without one returns `{success: false, error: 'pine editor not claimed by this lane — call pine_claim first'}`.
- `force: true` overrides as with tab_pin.

**Layer B: writable-by-default-OFF mode**

Add an env var or `~/.tv-mcp-config.json` flag: `PINE_WRITABLE_DEFAULT=false`. When false, all Pine-write tools (`pine_new`, `pine_set_source`, `pine_save`, `pine_smart_compile`) require an explicit `writable: true` per-call argument. This forces the operator to opt into write mode and makes accidental overwrites much harder.

**Layer C: per-instance isolated profile (out of scope here, design only)**

For truly parallel Pine dev, each instance launches Chrome at a DIFFERENT `user_data_dir`. Requires the user to sign into TradingView in each profile. Not a quick fix. Document in HANDOFF as a future option.

### Acceptance criteria

- Test 1: Instance A calls `pine_claim`. Instance B calls `pine_set_source` — returns `{conflict: true, owner: A}`.
- Test 2: Instance A calls `pine_release`. Instance B calls `pine_claim` successfully.
- Test 3: With `PINE_WRITABLE_DEFAULT=false`, `pine_set_source(source=X)` (no writable flag) returns `{success: false, error: 'pine editor is read-only by default'}`.

## Fix 4 — Deprecation messaging

Until the above ships, every Pine-write tool should emit a warning when called:

```js
console.error('[tv-mcp DEPRECATION] pine_new currently rebinds the editor to the LAST-LOADED script. ' +
              'A subsequent save will OVERWRITE that script. ' +
              'See INCIDENT-pine-overwrite-2026-06-05.md.');
```

Or — stronger — refuse to run unless `--unsafe-pine-write` is explicitly passed at server start. Pick whichever is less disruptive to the existing single-instance use cases.

---

## Test plan

1. **Unit tests** for the new behaviors (Fixes 1–3) using mocked CDP responses.
2. **Live integration test** on the isolated tv-mcp Chrome profile:
   - Create a new script via `pine_new`, verify it appears in `pine_list_scripts` and the editor is bound to it
   - Save twice with different sources, verify both saves persist via pine-facade
   - Use `force: true` to test claim override
   - Test the writable-default-off mode by setting the env var
3. **Multi-instance test**: start two Claude Code sessions, verify pine_claim conflicts work as designed.
4. **Recovery test**: simulate an accidental overwrite, verify the documented recovery procedure (fetch versioned source via pine-facade + Monaco action save) works end-to-end.

## Open questions for the next instance

1. **Exact pine-facade create endpoint** — needs DevTools Network capture during a manual "New script" in the TV UI. This is the unknown that gates Fix 1.
2. **Whether `editor.setValue` triggers Monaco's dirty-state tracking** — if it does, the save action might no-op when nothing actually changed. Need to verify.
3. **Cross-tab Pine editor state** — if two tabs are open on different charts, does the Pine editor instance survive a tab switch? Affects how the claim should be scoped.
4. **Whether `vs.editor.ICodeEditor:1:save.script` is stable across TV versions** — it's a custom action ID, could rename. Build a lookup-by-label fallback.

## When this should be picked up

After the incident write-up has been read by the user. The tradibos-nautilus instance has paused Pine integration of its three-way compare harness pending this fix. Other Nautilus work (multi-ticker smoke, Lopez de Prado validation, Lane 2 patterns on schwab-py) can proceed in parallel without Pine.
