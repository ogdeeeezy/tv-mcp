/**
 * Unit tests for the page-context helpers IS_STRATEGY_JS and
 * SCRAPE_STRATEGY_TESTER_JS exported from src/core/data.js.
 *
 * These run inside a fresh vm context with a mock document/sources, mirroring
 * how the strings are evaluated in the TradingView page via CDP.
 *
 * Run: node --test tests/data_strategy_helpers.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { IS_STRATEGY_JS, SCRAPE_STRATEGY_TESTER_JS } from '../src/core/data.js';

function loadIsStrategy() {
  const ctx = vm.createContext({});
  vm.runInContext(IS_STRATEGY_JS, ctx);
  return vm.runInContext('isStrategy', ctx);
}

function loadScrapeStrategyTester(querySelector) {
  const ctx = vm.createContext({ document: { querySelector } });
  vm.runInContext(SCRAPE_STRATEGY_TESTER_JS, ctx);
  return vm.runInContext('scrapeStrategyTester', ctx);
}

const source = (meta, extra = {}) => ({ metaInfo: () => meta, ...extra });

describe('IS_STRATEGY_JS — isStrategy()', () => {
  const isStrategy = loadIsStrategy();

  it('rejects null / undefined / no metaInfo', () => {
    assert.equal(isStrategy(null), false);
    assert.equal(isStrategy(undefined), false);
    assert.equal(isStrategy({}), false);
  });

  it('rejects when is_price_study is not strictly false', () => {
    assert.equal(isStrategy(source({ is_price_study: true })), false);
    assert.equal(isStrategy(source({})), false);
    assert.equal(isStrategy(source({ is_price_study: undefined })), false);
  });

  it('accepts meta.is_strategy === true overlay', () => {
    assert.equal(
      isStrategy(source({ is_price_study: false, is_strategy: true })),
      true
    );
  });

  it('accepts via reportData / performance (original detection)', () => {
    assert.equal(
      isStrategy(source({ is_price_study: false }, { reportData: {} })),
      true
    );
    assert.equal(
      isStrategy(source({ is_price_study: false }, { performance: () => ({}) })),
      true
    );
  });

  it('accepts via ordersData / tradesData / equityData / _orders (v6a fix)', () => {
    assert.equal(
      isStrategy(source({ is_price_study: false }, { ordersData: [] })),
      true
    );
    assert.equal(
      isStrategy(source({ is_price_study: false }, { tradesData: [] })),
      true
    );
    assert.equal(
      isStrategy(source({ is_price_study: false }, { equityData: [] })),
      true
    );
    assert.equal(
      isStrategy(source({ is_price_study: false }, { _orders: [1, 2, 3] })),
      true
    );
  });

  it('rejects price-overlay sources that lack every strategy hook', () => {
    assert.equal(isStrategy(source({ is_price_study: false })), false);
  });

  it('rejects when metaInfo() throws', () => {
    assert.equal(
      isStrategy({ metaInfo: () => { throw new Error('boom'); } }),
      false
    );
  });
});

describe('SCRAPE_STRATEGY_TESTER_JS — scrapeStrategyTester()', () => {
  it('returns null when the panel is missing', () => {
    const scrape = loadScrapeStrategyTester(() => null);
    assert.equal(scrape(), null);
  });

  it('returns null when the panel is empty', () => {
    const scrape = loadScrapeStrategyTester(() => ({ innerText: '' }));
    assert.equal(scrape(), null);
  });

  it('parses a Strategy Report with positive / negative / formatted values', () => {
    const innerText = [
      'W-Bottom v6a (ATR)',
      'CL1! · NYMEX',
      '2013-01-02 – 2026-05-16',
      'Total P&L',
      '20,532.50 USD',
      'Max equity drawdown',
      '−32,622.50 USD',
      'Total trades',
      '167',
      'Profitable trades',
      '44.31%',
      'Profit factor',
      '1.072',
    ].join('\n');
    const scrape = loadScrapeStrategyTester(() => ({ innerText }));
    const out = scrape();
    assert.ok(out, 'expected a result object');
    assert.equal(out.metrics.net_profit, 20532.5);
    assert.equal(out.metrics.max_drawdown, -32622.5);
    assert.equal(out.metrics.total_trades, 167);
    assert.equal(out.metrics.percent_profitable, 44.31);
    assert.equal(out.metrics.profit_factor, 1.072);
    assert.equal(out.meta.strategy_header, 'W-Bottom v6a (ATR)');
    assert.equal(out.meta.date_range, '2013-01-02 – 2026-05-16');
  });

  it('accepts alternate label spellings (Net Profit / Max Drawdown / Percent profitable)', () => {
    const innerText = [
      'Strategy X',
      'Net Profit',
      '1,000',
      'Max Drawdown',
      '-250',
      'Total closed trades',
      '42',
      'Percent profitable',
      '60',
    ].join('\n');
    const scrape = loadScrapeStrategyTester(() => ({ innerText }));
    const out = scrape();
    assert.equal(out.metrics.net_profit, 1000);
    assert.equal(out.metrics.max_drawdown, -250);
    assert.equal(out.metrics.total_trades, 42);
    assert.equal(out.metrics.percent_profitable, 60);
  });

  it('returns empty metrics when no labels match', () => {
    const innerText = 'Nothing useful here\nJust some other text\n123';
    const scrape = loadScrapeStrategyTester(() => ({ innerText }));
    const out = scrape();
    assert.equal(Object.keys(out.metrics).length, 0);
  });
});
