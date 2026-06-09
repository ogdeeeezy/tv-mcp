/**
 * Core Pine Script logic — shared between MCP tools and CLI.
 * All functions accept plain options objects and return plain JS objects.
 * They throw on error (callers catch and format).
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';
import { getPineEditorClaim, claimPineEditor, releasePineEditor } from './pin_registry.js';

// ── Pine editor claim gate ──
//
// Write tools (newScript, setSource, save, smartCompile, compile) all mutate
// either the Monaco buffer or the cloud script slot. Without a claim, two MCP
// processes sharing this Chrome will race on every call and silently overwrite
// each other (incident 2026-06-05). This gate makes the contract explicit:
// the caller must hold the pine_editor claim or the write is refused.
//
// Bypass for back-compat / single-instance dev: set TV_MCP_PINE_WRITE_UNGATED=1
// at server start. Off by default — the default has to be safe.

async function requirePineClaim() {
  if (process.env.TV_MCP_PINE_WRITE_UNGATED === '1') return { ungated: true };
  const claim = await getPineEditorClaim();
  if (!claim) {
    const err = new Error(
      'Pine editor not claimed by this process. Call pine_claim before any pine_new/pine_set_source/pine_save/pine_smart_compile/pine_compile. ' +
      'This gate exists to prevent two Claude sessions from silently overwriting each other (incident 2026-06-05).'
    );
    err.code = 'PINE_NOT_CLAIMED';
    throw err;
  }
  if (claim.pid !== process.pid) {
    const err = new Error(
      `Pine editor claimed by pid=${claim.pid} (lane=${claim.lane || 'unknown'}, host=${claim.host}). ` +
      'This process cannot write. Wait for the owner to call pine_release, or call pine_claim with force=true to take over.'
    );
    err.code = 'PINE_CLAIMED_BY_OTHER';
    err.owner = claim;
    throw err;
  }
  return claim;
}

export async function pineClaim({ force = false, lane = null, scriptIdPart = null } = {}) {
  try {
    const { entry, displaced } = await claimPineEditor({ force, lane, scriptIdPart });
    return {
      success: true,
      claim: entry,
      displaced,
      action: displaced ? 'forced_claim' : 'claimed',
    };
  } catch (err) {
    if (err.code === 'PINE_CONFLICT') {
      return { success: false, conflict: true, owner: err.owner, error: err.message };
    }
    throw err;
  }
}

export async function pineRelease() {
  const { released } = await releasePineEditor();
  return { success: true, released };
}

export async function pineClaimStatus() {
  const claim = await getPineEditorClaim();
  return {
    success: true,
    claimed: !!claim,
    claim,
    mine: claim ? claim.pid === process.pid : false,
  };
}

// ── Monaco finder (injected into TV page) ──
const FIND_MONACO = `
  (function findMonacoEditor() {
    var container = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!container) return null;
    var el = container;
    var fiberKey;
    for (var i = 0; i < 20; i++) {
      if (!el) break;
      fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
      if (fiberKey) break;
      el = el.parentElement;
    }
    if (!fiberKey) return null;
    var current = el[fiberKey];
    for (var d = 0; d < 15; d++) {
      if (!current) break;
      if (current.memoizedProps && current.memoizedProps.value && current.memoizedProps.value.monacoEnv) {
        var env = current.memoizedProps.value.monacoEnv;
        if (env.editor && typeof env.editor.getEditors === 'function') {
          var editors = env.editor.getEditors();
          if (editors.length > 0) return { editor: editors[0], env: env };
        }
      }
      current = current.return;
    }
    return null;
  })()
`;

/**
 * Opens the Pine Editor panel and waits for Monaco to become available.
 * Returns true if editor is accessible, false on timeout.
 */
export async function ensurePineEditorOpen() {
  const already = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      return m !== null;
    })()
  `);
  if (already) return true;

  await evaluate(`
    (function() {
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      if (!bwb) return;
      if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab();
      else if (typeof bwb.showWidget === 'function') bwb.showWidget('pine-editor');
    })()
  `);

  await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Pine"]')
        || document.querySelector('[data-name="pine-dialog-button"]');
      if (btn) btn.click();
    })()
  `);

  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ready = await evaluate(`(function() { return ${FIND_MONACO} !== null; })()`);
    if (ready) return true;
  }
  return false;
}

// ── Pure / offline functions ──

export function analyze({ source }) {
  const lines = source.split('\n');
  const diagnostics = [];

  let isV6 = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//@version=6')) { isV6 = true; break; }
    if (trimmed.startsWith('//@version=')) break;
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    break;
  }

  const arrays = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fromMatch = line.match(/(\w+)\s*=\s*array\.from\(([^)]*)\)/);
    if (fromMatch) {
      const name = fromMatch[1].trim();
      const args = fromMatch[2].trim();
      const size = args === '' ? 0 : args.split(',').length;
      arrays.set(name, { name, size, line: i + 1 });
      continue;
    }
    const newMatch = line.match(/(\w+)\s*=\s*array\.new(?:<\w+>|_\w+)\((\d+)?/);
    if (newMatch) {
      const name = newMatch[1].trim();
      const size = newMatch[2] !== undefined ? parseInt(newMatch[2], 10) : null;
      arrays.set(name, { name, size, line: i + 1 });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pattern = /array\.(get|set)\(\s*(\w+)\s*,\s*(-?\d+)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const method = match[1];
      const arrName = match[2];
      const idx = parseInt(match[3], 10);
      const info = arrays.get(arrName);
      if (!info || info.size === null) continue;
      if (idx < 0 || idx >= info.size) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `array.${method}(${arrName}, ${idx}) — index ${idx} out of bounds (array size is ${info.size})`,
          severity: 'error',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstLastPattern = /(\w+)\.(first|last)\(\)/g;
    let match;
    while ((match = firstLastPattern.exec(line)) !== null) {
      const arrName = match[1];
      if (arrName === 'array') continue;
      const info = arrays.get(arrName);
      if (info && info.size === 0) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `${arrName}.${match[2]}() called on possibly empty array (declared with size 0)`,
          severity: 'warning',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.includes('strategy.entry') || trimmed.includes('strategy.close')) {
      let hasStrategyDecl = false;
      for (const l of lines) {
        if (l.trim().startsWith('strategy(')) { hasStrategyDecl = true; break; }
      }
      if (!hasStrategyDecl) {
        diagnostics.push({
          line: i + 1, column: 1,
          message: 'strategy.entry/close used but no strategy() declaration found — did you mean to use indicator()?',
          severity: 'error',
        });
        break;
      }
    }
  }

  if (!isV6 && source.includes('//@version=')) {
    const vMatch = source.match(/\/\/@version=(\d+)/);
    if (vMatch && parseInt(vMatch[1]) < 5) {
      diagnostics.push({
        line: 1, column: 1,
        message: `Script uses Pine v${vMatch[1]} — consider upgrading to v6 for latest features`,
        severity: 'info',
      });
    }
  }

  return {
    success: true,
    issue_count: diagnostics.length,
    diagnostics,
    note: diagnostics.length === 0 ? 'No static analysis issues found. Use pine_compile or pine_smart_compile for full server-side compilation check.' : undefined,
  };
}

export async function check({ source }) {
  const formData = new URLSearchParams();
  formData.append('source', source);

  const response = await fetch(
    'https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000',
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.tradingview.com/',
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(`TradingView API returned ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  const errors = [];
  const warnings = [];
  const inner = result?.result;

  if (inner) {
    if (inner.errors2 && inner.errors2.length > 0) {
      for (const e of inner.errors2) {
        errors.push({
          line: e.start?.line, column: e.start?.column,
          end_line: e.end?.line, end_column: e.end?.column,
          message: e.message,
        });
      }
    }
    if (inner.warnings2 && inner.warnings2.length > 0) {
      for (const w of inner.warnings2) {
        warnings.push({ line: w.start?.line, column: w.start?.column, message: w.message });
      }
    }
  }

  if (result.error && typeof result.error === 'string') {
    errors.push({ message: result.error });
  }

  const compiled = errors.length === 0;
  return {
    success: true,
    compiled,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    note: compiled ? 'Pine Script compiled successfully.' : undefined,
  };
}

// ── Functions requiring TradingView connection ──

export async function getSource() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor or Monaco not found in React fiber tree.');

  const source = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return null;
      return m.editor.getValue();
    })()
  `);

  if (source === null || source === undefined) {
    throw new Error('Monaco editor found but getValue() returned null.');
  }

  return { success: true, source, line_count: source.split('\n').length, char_count: source.length };
}

export async function setSource({ source }) {
  await requirePineClaim();
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const escaped = JSON.stringify(source);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco found but setValue() failed.');
  return { success: true, lines_set: source.split('\n').length };
}

export async function compile() {
  await requirePineClaim();
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const clicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var fallback = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!fallback && /^(Add to chart|Update on chart)/i.test(text)) {
          fallback = btns[i];
        }
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) {
          saveBtn = btns[i];
        }
      }
      if (fallback) { fallback.click(); return fallback.textContent.trim(); }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!clicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2000));
  return { success: true, button_clicked: clicked || 'keyboard_shortcut', source: 'dom_fallback' };
}

export async function getErrors() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  return {
    success: true,
    has_errors: errors?.length > 0,
    error_count: errors?.length || 0,
    errors: errors || [],
  };
}

// ── Pine editor binding inspection ──
//
// TV's web Pine Editor tracks two separate states:
//   1. The Monaco editor's text buffer (mutated by setValue, openScript, etc.)
//   2. The "currently bound cloud script slot" — i.e., what `save.script` writes to
//
// The 2026-06-05 incident proved that (1) and (2) drift apart: setValue mutates
// the buffer but leaves the bound slot pointing at whatever was last loaded.
// Save then overwrites the previously-bound slot — silent data loss.
//
// Detection: TV's title button (data-qa-id="pine-script-title-button") displays
// the bound slot's name, or "Untitled script" when the editor is unbound (e.g.,
// after running the new_indicator/new_strategy Monaco action).
async function getEditorBindingState() {
  const state = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-qa-id="pine-script-title-button"]');
      var title = btn ? btn.textContent.trim() : null;
      var m = ${FIND_MONACO};
      var modelUri = null;
      var isSaveEnabled = null;
      if (m) {
        var editor = m.editor;
        if (editor) {
          modelUri = editor.getModel() ? editor.getModel().uri.toString() : null;
          if (editor._contextKeyService) {
            isSaveEnabled = editor._contextKeyService.getContextKeyValue('isSaveEnabled');
          }
        }
      }
      return { title: title, modelUri: modelUri, isSaveEnabled: isSaveEnabled };
    })()
  `);
  return {
    title: state?.title || null,
    modelUri: state?.modelUri || null,
    isSaveEnabled: !!state?.isSaveEnabled,
    bound: state?.title && state.title !== 'Untitled script',
  };
}

// ── Direct POST to pine-facade/save/new ──
//
// Endpoint discovered via probe 2026-06-07: POST creates a new cloud script slot
// with the given name and source. The `allow_overwrite=false` URL param refuses
// to overwrite an existing script with the same name (returns 4xx instead).
async function saveNew({ name, source }) {
  const escapedSource = JSON.stringify(source);
  const escapedName = JSON.stringify(name);
  const result = await evaluateAsync(`
    (function() {
      var fd = new FormData();
      fd.append('source', ${escapedSource});
      return fetch(
        'https://pine-facade.tradingview.com/pine-facade/save/new?name=' +
          encodeURIComponent(${escapedName}) + '&allow_overwrite=false',
        { method: 'POST', body: fd, credentials: 'include' }
      ).then(function(r) {
        return r.text().then(function(t) {
          var parsed = null;
          try { parsed = JSON.parse(t); } catch (e) {}
          return { status: r.status, ok: r.ok, body: parsed, raw: parsed ? null : t.slice(0, 500) };
        });
      }).catch(function(e) { return { error: e.message }; });
    })()
  `);

  if (result?.error) throw new Error('pine-facade fetch failed: ' + result.error);
  if (!result?.ok) {
    throw new Error(
      'pine-facade /save/new returned HTTP ' + result?.status + ': ' +
      JSON.stringify(result?.body || result?.raw || '').slice(0, 300)
    );
  }

  const body = result.body || {};
  // Observed response shape (probe 2026-06-07):
  //   { success: true, result: { metaInfo: { scriptIdPart, description, pine: { version }, ... } } }
  // The metaInfo block carries the canonical IDs. Fall back to flatter shapes defensively.
  const metaInfo = (body.result && body.result.metaInfo) || {};
  const inner = body.result || body;
  const scriptIdPart =
    metaInfo.scriptIdPart ||
    inner.scriptIdPart ||
    body.scriptIdPart ||
    null;
  const version =
    (metaInfo.pine && metaInfo.pine.version) ||
    inner.version ||
    body.version ||
    '1.0';
  if (!scriptIdPart) {
    throw new Error(
      'pine-facade /save/new succeeded but response did not include scriptIdPart: ' +
      JSON.stringify(body).slice(0, 300)
    );
  }
  return {
    scriptIdPart,
    name: metaInfo.description || inner.name || body.name || name,
    version,
  };
}

export async function save({ name = null, verify_timeout_ms = 5000 } = {}) {
  await requirePineClaim();
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const binding = await getEditorBindingState();

  // Get current editor source for verification / save-new payload
  const sourceProbe = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return null;
      return m.editor.getValue();
    })()
  `);
  if (sourceProbe === null || sourceProbe === undefined) {
    throw new Error('Could not read current editor source.');
  }
  const currentSource = sourceProbe;

  // ── Unbound editor: cannot use save.script (would create new slot anyway, but the
  //    title-prompt flow is brittle). Require an explicit name and POST directly.
  if (!binding.bound) {
    if (!name) {
      const err = new Error(
        'Editor is an unbound draft (title="Untitled script"). To persist, pass `name` to ' +
        'create a new cloud slot, or call pine_open first to bind to an existing script.'
      );
      err.code = 'PINE_UNBOUND_NEEDS_NAME';
      throw err;
    }
    const created = await saveNew({ name, source: currentSource });
    return {
      success: true,
      action: 'saved_as_new',
      scriptIdPart: created.scriptIdPart,
      name: created.name,
      version: created.version,
      verified: true,
      verify_source: 'pine-facade/save/new response',
    };
  }

  // ── Bound editor: invoke Monaco save.script command + verify via pine-facade poll.
  //    The command updates the currently-bound cloud slot (or no-ops if !isSaveEnabled).
  if (!binding.isSaveEnabled) {
    return {
      success: true,
      action: 'noop',
      reason: 'isSaveEnabled=false (editor is bound but not dirty — nothing to save)',
      bound_to_title: binding.title,
    };
  }

  // Find the scriptIdPart for the currently-bound slot by matching the title against pine-facade list
  const boundLookup = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/list?filter=saved', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return { error: 'unexpected list response' };
        var target = ${JSON.stringify(binding.title)};
        var match = null;
        for (var i = 0; i < data.length; i++) {
          var name = data[i].scriptName || '';
          var title = data[i].scriptTitle || '';
          if (name === target || title === target) { match = data[i]; break; }
        }
        return match ? { scriptIdPart: match.scriptIdPart, version: match.version } : { error: 'no script matching title ' + JSON.stringify(target) };
      })
      .catch(function(e) { return { error: e.message }; })
  `);
  if (boundLookup?.error) {
    throw new Error('Could not identify bound scriptIdPart: ' + boundLookup.error);
  }
  const boundScriptIdPart = boundLookup.scriptIdPart;
  const versionBefore = boundLookup.version;

  // Invoke the save.script command via the editor's command service
  const invoked = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return { ok: false, error: 'no editor' };
      var editor = m.editor;
      if (!editor || !editor._commandService) return { ok: false, error: 'no command service' };
      try {
        editor._commandService.executeCommand('vs.editor.ICodeEditor:1:save.script');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })()
  `);
  if (!invoked?.ok) throw new Error('save.script invocation failed: ' + (invoked?.error || 'unknown'));

  // Verify: poll pine-facade /get/{id}/last until source matches OR timeout
  const expectedSource = currentSource;
  const escapedExpected = JSON.stringify(expectedSource);
  const escapedId = JSON.stringify(boundScriptIdPart);
  const verify = await evaluateAsync(`
    (function() {
      var deadline = Date.now() + ${Number(verify_timeout_ms) | 0};
      // TV normalizes line endings to \\r\\n on store; normalize both sides for comparison.
      function norm(s) { return (s || '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n'); }
      var expected = norm(${escapedExpected});
      function poll() {
        if (Date.now() > deadline) return { ok: false, reason: 'timeout' };
        return fetch(
          'https://pine-facade.tradingview.com/pine-facade/get/' + encodeURIComponent(${escapedId}) + '/last',
          { credentials: 'include' }
        ).then(function(r) { return r.json(); }).then(function(j) {
          var src = norm((j && (j.source || (j.result && j.result.source))) || '');
          var version = (j && (j.version || (j.result && j.result.version))) || null;
          if (src === expected) return { ok: true, version: version };
          return new Promise(function(resolve) { setTimeout(function() { resolve(poll()); }, 200); });
        }).catch(function(e) { return { ok: false, reason: e.message }; });
      }
      return poll();
    })()
  `);

  if (!verify?.ok) {
    return {
      success: false,
      action: 'save_invoked_but_not_verified',
      scriptIdPart: boundScriptIdPart,
      reason: verify?.reason || 'unknown',
      version_before: versionBefore,
    };
  }

  return {
    success: true,
    action: 'saved_and_verified',
    scriptIdPart: boundScriptIdPart,
    version_before: versionBefore,
    version_after: verify.version,
    verified: true,
    verify_source: 'pine-facade/get/' + boundScriptIdPart + '/last',
  };
}

export async function getConsole() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const entries = await evaluate(`
    (function() {
      var results = [];
      var rows = document.querySelectorAll('[class*="consoleRow"], [class*="log-"], [class*="consoleLine"]');
      if (rows.length === 0) {
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]')
          || document.querySelector('[class*="bottom-widgetbar-content"]');
        if (bottomArea) {
          rows = bottomArea.querySelectorAll('[class*="message"], [class*="log"], [class*="console"]');
        }
      }
      if (rows.length === 0) {
        var pinePanel = document.querySelector('.pine-editor-container')
          || document.querySelector('[class*="pine-editor"]')
          || document.querySelector('[class*="layout__area--bottom"]');
        if (pinePanel) {
          var allSpans = pinePanel.querySelectorAll('span, div');
          for (var s = 0; s < allSpans.length; s++) {
            var txt = allSpans[s].textContent.trim();
            if (/^\\d{2}:\\d{2}:\\d{2}/.test(txt) || /error|warning|info/i.test(allSpans[s].className)) {
              rows = Array.from(rows || []);
              rows.push(allSpans[s]);
            }
          }
        }
      }
      for (var i = 0; i < rows.length; i++) {
        var text = rows[i].textContent.trim();
        if (!text) continue;
        var ts = null;
        var tsMatch = text.match(/^(\\d{4}-\\d{2}-\\d{2}\\s+)?\\d{2}:\\d{2}:\\d{2}/);
        if (tsMatch) ts = tsMatch[0];
        var type = 'info';
        var cls = rows[i].className || '';
        if (/error/i.test(cls) || /error/i.test(text.substring(0, 30))) type = 'error';
        else if (/compil/i.test(text.substring(0, 40))) type = 'compile';
        else if (/warn/i.test(cls)) type = 'warning';
        results.push({ timestamp: ts, type: type, message: text });
      }
      return results;
    })()
  `);

  return { success: true, entries: entries || [], entry_count: entries?.length || 0 };
}

export async function smartCompile() {
  await requirePineClaim();
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const studiesBefore = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') return chart.getAllStudies().length;
      } catch(e) {}
      return null;
    })()
  `);

  const buttonClicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var addBtn = null;
      var updateBtn = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!addBtn && /^add to chart$/i.test(text)) addBtn = btns[i];
        if (!updateBtn && /^update on chart$/i.test(text)) updateBtn = btns[i];
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) saveBtn = btns[i];
      }
      if (addBtn) { addBtn.click(); return 'Add to chart'; }
      if (updateBtn) { updateBtn.click(); return 'Update on chart'; }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!buttonClicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2500));

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  const studiesAfter = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') return chart.getAllStudies().length;
      } catch(e) {}
      return null;
    })()
  `);

  const studyAdded = (studiesBefore !== null && studiesAfter !== null) ? studiesAfter > studiesBefore : null;

  return {
    success: true,
    button_clicked: buttonClicked || 'keyboard_shortcut',
    has_errors: errors?.length > 0,
    errors: errors || [],
    study_added: studyAdded,
  };
}

export async function newScript({ type, name = null, source = null } = {}) {
  await requirePineClaim();
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const templates = {
    indicator: '//@version=6\nindicator("My script")\nplot(close)\n',
    strategy: '//@version=6\nstrategy("My strategy", overlay=true)\n',
    library: '//@version=6\n// @description TODO: add library description here\nlibrary("MyLibrary")\n',
  };
  const resolvedType = templates[type] ? type : 'indicator';
  const template = source || templates[resolvedType];

  // CRITICAL SAFETY STEP: invoke TV's Monaco new_indicator/new_strategy action.
  // This swaps the editor to a fresh unbound Monaco model, decoupling it from
  // whichever cloud script slot was previously bound. Without this step, a
  // subsequent setValue + save would overwrite that slot — the 2026-06-05 incident.
  //
  // TV does not register `new_library` — for library type, we use new_indicator
  // to unbind (template content is then replaced via setValue below).
  const actionId = resolvedType === 'strategy'
    ? 'vs.editor.ICodeEditor:1:new_strategy'
    : 'vs.editor.ICodeEditor:1:new_indicator';

  const swapped = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return { ok: false, error: 'no editor' };
      var editor = m.editor;
      var actions = editor.getSupportedActions();
      var action = actions.find(function(a) { return a.id === ${JSON.stringify(actionId)}; });
      if (!action) return { ok: false, error: 'action not registered: ' + ${JSON.stringify(actionId)} };
      try {
        action.run();
        return { ok: true, oldUri: editor.getModel().uri.toString() };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })()
  `);
  if (!swapped?.ok) throw new Error('Monaco new action failed: ' + (swapped?.error || 'unknown'));

  // Wait briefly for the model swap to settle (TV creates a new Monaco model)
  await new Promise(r => setTimeout(r, 150));

  // Install our source into the now-unbound editor
  const escapedSource = JSON.stringify(template);
  const installed = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return { ok: false, error: 'no editor after swap' };
      var editor = m.editor;
      editor.setValue(${escapedSource});
      return {
        ok: true,
        modelUri: editor.getModel().uri.toString(),
        isSaveEnabled: editor._contextKeyService ? editor._contextKeyService.getContextKeyValue('isSaveEnabled') : null,
      };
    })()
  `);
  if (!installed?.ok) throw new Error('Failed to install source: ' + (installed?.error || 'unknown'));

  // If `name` is provided, immediately persist as a new cloud slot via pine-facade.
  // Otherwise, the editor sits as an unbound draft until pine_save({name}) is called.
  let persisted = false;
  let scriptIdPart = null;
  let version = null;
  if (name) {
    const created = await saveNew({ name, source: template });
    persisted = true;
    scriptIdPart = created.scriptIdPart;
    version = created.version;
  }

  return {
    success: true,
    type: resolvedType,
    action: persisted ? 'new_script_created_and_persisted' : 'unbound_draft_created',
    scriptIdPart,
    name: name || null,
    version,
    persisted,
    model_uri: installed.modelUri,
    safety_note: persisted
      ? 'Cloud slot created via pine-facade/save/new. Editor remains unbound — future pine_save calls will need {name} unless you call pine_open first to bind.'
      : 'Editor is an unbound draft (decoupled from any pre-existing slot). To persist, call pine_save({ name: "..." }). The editor CANNOT accidentally overwrite an existing script while unbound.',
  };
}

export async function openScript({ name }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const escapedName = JSON.stringify(name.toLowerCase());

  const result = await evaluateAsync(`
    (function() {
      var target = ${escapedName};
      return fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(scripts) {
          if (!Array.isArray(scripts)) return {error: 'pine-facade returned unexpected data'};
          var match = null;
          for (var i = 0; i < scripts.length; i++) {
            var sn = (scripts[i].scriptName || '').toLowerCase();
            var st = (scripts[i].scriptTitle || '').toLowerCase();
            if (sn === target || st === target) { match = scripts[i]; break; }
          }
          if (!match) {
            for (var j = 0; j < scripts.length; j++) {
              var sn2 = (scripts[j].scriptName || '').toLowerCase();
              var st2 = (scripts[j].scriptTitle || '').toLowerCase();
              if (sn2.indexOf(target) !== -1 || st2.indexOf(target) !== -1) { match = scripts[j]; break; }
            }
          }
          if (!match) return {error: 'Script "' + target + '" not found. Use pine_list_scripts to see available scripts.'};

          var id = match.scriptIdPart;
          var ver = match.version || 1;
          return fetch('https://pine-facade.tradingview.com/pine-facade/get/' + id + '/' + ver, { credentials: 'include' })
            .then(function(r2) { return r2.json(); })
            .then(function(data) {
              var source = data.source || '';
              if (!source) return {error: 'Script source is empty', name: match.scriptName || match.scriptTitle};
              var m = ${FIND_MONACO};
              if (m) {
                m.editor.setValue(source);
                return {success: true, name: match.scriptName || match.scriptTitle, id: id, lines: source.split('\\n').length};
              }
              return {error: 'Monaco editor not found to inject source', name: match.scriptName || match.scriptTitle};
            });
        })
        .catch(function(e) { return {error: e.message}; });
    })()
  `);

  if (result?.error) {
    throw new Error(result.error);
  }

  return { success: true, name: result.name, script_id: result.id, lines: result.lines, source: 'internal_api', opened: true };
}

export async function listScripts() {
  const scripts = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return {scripts: [], error: 'Unexpected response from pine-facade'};
        return {
          scripts: data.map(function(s) {
            return {
              id: s.scriptIdPart || null,
              name: s.scriptName || s.scriptTitle || 'Untitled',
              title: s.scriptTitle || null,
              version: s.version || null,
              modified: s.modified || null,
            };
          })
        };
      })
      .catch(function(e) { return {scripts: [], error: e.message}; })
  `);

  return {
    success: true,
    scripts: scripts?.scripts || [],
    count: scripts?.scripts?.length || 0,
    source: 'internal_api',
    error: scripts?.error,
  };
}
