/**
 * Tests for parseSymbolFromTitle — the title→symbol parser used by tab_picker
 * to populate the `symbol` field. The parser feeds tab_pin's symbol= matcher,
 * so misses here cause silent "pin found no match" failures for callers.
 *
 * Adding new TradingView title formats here is the easy way to make
 * tab_pin symbol= work for them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbolFromTitle } from '../src/core/tab.js';

describe('parseSymbolFromTitle — old parenthesized format', () => {
  it('extracts symbol from "DESC (SYM), Nh Chart"', () => {
    assert.equal(parseSymbolFromTitle('GOLD FUTURES (GC1!), 4h Chart Online — TradingView'), 'GC1!');
  });
  it('extracts symbol from "FULLNAME (TICKER),"', () => {
    assert.equal(parseSymbolFromTitle('ROBLOX CORP (RBLX), 1D Chart'), 'RBLX');
  });
  it('extracts crypto symbols with !', () => {
    assert.equal(parseSymbolFromTitle('S&P 500 E-MINI (ES1!), 5m Chart'), 'ES1!');
  });
});

describe('parseSymbolFromTitle — leading-symbol format (TradingView web, 2026+)', () => {
  it('extracts GC1! from price-leading title', () => {
    assert.equal(parseSymbolFromTitle('GC1! 4,557.2 ▼ −2.73% gold'), 'GC1!');
  });
  it('extracts RBLX from price-leading title', () => {
    assert.equal(parseSymbolFromTitle('RBLX 145.32 ▲ +2.1%'), 'RBLX');
  });
  it('extracts long crypto symbols', () => {
    assert.equal(parseSymbolFromTitle('BTCUSDT 67,234.5 ▲ +1.2%'), 'BTCUSDT');
  });
  it('handles symbols with dots (e.g. BRK.B)', () => {
    assert.equal(parseSymbolFromTitle('BRK.B 423.15 ▼ −0.4%'), 'BRK.B');
  });
  it('handles ES1! futures notation', () => {
    assert.equal(parseSymbolFromTitle('ES1! 5,234.50 ▲ +0.3%'), 'ES1!');
  });
});

describe('parseSymbolFromTitle — must NOT match', () => {
  it('returns null for non-chart pages', () => {
    assert.equal(parseSymbolFromTitle('TradingView — Track All Markets'), null);
  });
  it('returns null for "Loading..." style titles', () => {
    assert.equal(parseSymbolFromTitle('Loading...'), null);
  });
  it('returns null for empty / non-string input', () => {
    assert.equal(parseSymbolFromTitle(''), null);
    assert.equal(parseSymbolFromTitle(null), null);
    assert.equal(parseSymbolFromTitle(undefined), null);
    assert.equal(parseSymbolFromTitle(123), null);
  });
  it('returns null when title has no symbol-like prefix', () => {
    assert.equal(parseSymbolFromTitle('some lowercase title with 123 numbers'), null);
  });
  it('returns null for sentence-case words (no upper-only prefix + price)', () => {
    // "TradingView" starts upper but has lowercase chars — the regex's
    // [A-Z][A-Z0-9!.:-]* would only capture "T", then fail on "r".
    assert.equal(parseSymbolFromTitle('TradingView 1234'), null);
  });
});

describe('parseSymbolFromTitle — precedence', () => {
  it('prefers parenthesized format when both could match', () => {
    // Hypothetical hybrid: leading text with parens AND a price afterward.
    // The parenthesized regex hits first and wins.
    assert.equal(parseSymbolFromTitle('NVDA CORP (NVDA1), 4h 145.23'), 'NVDA1');
  });
});
