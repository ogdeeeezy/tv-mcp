/**
 * Unit tests for selectDeleteTarget — the input-validation/lookup helper used
 * by pine_delete. The pine-facade fetch itself is exercised by manual smoke
 * test against a live TV session (see HANDOFF-tv-mcp.md, follow-up #2 close).
 *
 * Run: node --test tests/pine_delete.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectDeleteTarget } from '../src/core/pine.js';

const FIXTURE = [
  { id: 'USER;aaa', name: 'foo', title: 'Foo' },
  { id: 'USER;bbb', name: 'bar', title: 'Bar' },
  { id: 'USER;ccc', name: 'bar', title: 'Bar dup' },
  { id: 'USER;ddd', name: 'MixedCase', title: 'Mixed' },
];

describe('selectDeleteTarget', () => {
  it('resolves unique name match', () => {
    const t = selectDeleteTarget({ scripts: FIXTURE, name: 'foo' });
    assert.equal(t.id, 'USER;aaa');
    assert.equal(t.name, 'foo');
    assert.equal(t.matched_by, 'name');
  });

  it('is case-insensitive on name lookup', () => {
    const t = selectDeleteTarget({ scripts: FIXTURE, name: 'mixedcase' });
    assert.equal(t.id, 'USER;ddd');
    const t2 = selectDeleteTarget({ scripts: FIXTURE, name: 'FOO' });
    assert.equal(t2.id, 'USER;aaa');
  });

  it('refuses ambiguous name match with PINE_DELETE_AMBIGUOUS and exposes matches', () => {
    let caught;
    try { selectDeleteTarget({ scripts: FIXTURE, name: 'bar' }); }
    catch (e) { caught = e; }
    assert.ok(caught, 'expected throw on ambiguous match');
    assert.equal(caught.code, 'PINE_DELETE_AMBIGUOUS');
    assert.equal(caught.matches.length, 2);
    assert.deepEqual(
      caught.matches.map((m) => m.id).sort(),
      ['USER;bbb', 'USER;ccc']
    );
  });

  it('refuses unknown name with PINE_DELETE_NOT_FOUND', () => {
    assert.throws(
      () => selectDeleteTarget({ scripts: FIXTURE, name: 'nonexistent' }),
      (err) => err.code === 'PINE_DELETE_NOT_FOUND'
    );
  });

  it('resolves by scriptIdPart', () => {
    const t = selectDeleteTarget({ scripts: FIXTURE, scriptIdPart: 'USER;bbb' });
    assert.equal(t.id, 'USER;bbb');
    assert.equal(t.matched_by, 'scriptIdPart');
  });

  it('refuses unknown scriptIdPart with PINE_DELETE_NOT_FOUND', () => {
    assert.throws(
      () => selectDeleteTarget({ scripts: FIXTURE, scriptIdPart: 'USER;xxx' }),
      (err) => err.code === 'PINE_DELETE_NOT_FOUND'
    );
  });

  it('refuses when neither arg is provided', () => {
    assert.throws(
      () => selectDeleteTarget({ scripts: FIXTURE }),
      (err) => err.code === 'PINE_DELETE_MISSING_ARG'
    );
  });

  it('refuses when both args are empty strings', () => {
    assert.throws(
      () => selectDeleteTarget({ scripts: FIXTURE, name: '', scriptIdPart: '' }),
      (err) => err.code === 'PINE_DELETE_MISSING_ARG'
    );
  });

  it('scriptIdPart wins when both args are provided', () => {
    const t = selectDeleteTarget({
      scripts: FIXTURE,
      name: 'foo',
      scriptIdPart: 'USER;bbb',
    });
    assert.equal(t.id, 'USER;bbb');
    assert.equal(t.matched_by, 'scriptIdPart');
  });

  it('handles empty script list', () => {
    assert.throws(
      () => selectDeleteTarget({ scripts: [], name: 'foo' }),
      (err) => err.code === 'PINE_DELETE_NOT_FOUND'
    );
  });
});
