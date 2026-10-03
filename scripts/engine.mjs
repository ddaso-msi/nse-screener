// Loads NSE history into the form the backtest engine works on. The engine
// itself (the trade model and statistics) is in engine-core.mjs, which has no
// Node dependencies so the hosted app can run the same code in the browser.
//
// Used by the CLI (scripts/backtest.mjs), the brief, and the dev server's
// /api/backtest endpoint.
//
// Model: a stock "signals" on the first day it matches a screen (not on each
// following day it keeps matching). Entry is the next session's open. The
// trade exits at the stop-loss or target if one is set and touched, otherwise
// at the close `hold` sessions after the signal. Each trade is compared with
// the average liquid stock bought the same day and simply held for `hold`
// sessions, so a rising market doesn't flatter a screen.

import { derivativeSeries, fetchDerivatives, loadDerivatives } from './derivatives.mjs';
import { loadEtfList } from './etf.mjs';
import { fetchExtras, fundamentalSeries, loadFundamentals } from './fundamentals.mjs';
import { METRICS, PRICE_FLAGS } from './engine-core.mjs';
import { loadResults, resultsSeries } from './results.mjs';
import { detectPatterns } from './patterns.mjs';
import { adjust, cachedList, fetchDays, loadHistory, rankTo99, rsScore } from './sync.mjs';

export const DEFAULT_LOOKBACK = 1100; // calendar days, ~3 years
const MIN_BARS = 30;

// the rest are filled in by fundamentalSeries(), resultsSeries() and derivativeSeries()
const COMPUTED = METRICS.slice(0, METRICS.indexOf('mcap'));
const INDEX_LISTS = [
  ['N50', 'ind_nifty50list'],
  ['NN50', 'ind_niftynext50list'],
  ['MID150', 'ind_niftymidcap150list'],
  ['SML250', 'ind_niftysmallcap250list'],
  ['MIC250', 'ind_niftymicrocap250_list'],
];

const pct = (a, b) => (b ? (a / b - 1) * 100 : NaN);

// Per-session metrics with the same definitions as metrics() in sync.mjs,
// stored as one typed array per metric (NaN = not available).
function columns(bars) {
  const n = bars.length;
  const m = Object.fromEntries(COMPUTED.map((k) => [k, new Float32Array(n).fill(NaN)]));
  const f = Object.fromEntries(PRICE_FLAGS.map((k) => [k, new Uint8Array(n)]));
  const c = bars.map((b) => b.c);
  const ps = [0];
  for (const x of c) ps.push(ps[ps.length - 1] + x);
  const sma = (k, t) => (t + 1 >= k ? (ps[t + 1] - ps[t + 1 - k]) / k : NaN);
  const ret = (t, k) => (t >= k ? pct(c[t], c[t - k]) : NaN);
  let gain = 0, loss = 0;

  for (let t = 0; t < n; t++) {
    if (t >= 1) {
      const d = c[t] - c[t - 1];
      if (t <= 14) {
        gain += Math.max(d, 0) / 14;
        loss += Math.max(-d, 0) / 14;
      } else {
        gain = (gain * 13 + Math.max(d, 0)) / 14;
        loss = (loss * 13 + Math.max(-d, 0)) / 14;
      }
      if (t >= 14) m.rsi[t] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }

    const from = Math.max(0, t - 251);
    let hi = -Infinity, lo = Infinity, priorHi = -Infinity, priorLo = Infinity;
    for (let i = from; i <= t; i++) {
      if (i < t) {
        if (bars[i].h > priorHi) priorHi = bars[i].h;
        if (bars[i].l < priorLo) priorLo = bars[i].l;
      }
      if (bars[i].h > hi) hi = bars[i].h;
      if (bars[i].l < lo) lo = bars[i].l;
    }

    if (t >= 20) {
      let vol = 0;
      for (let i = t - 20; i < t; i++) vol += bars[i].v;
      if (vol > 0) m.volX[t] = bars[t].v / (vol / 20);
    }
    let tv = 0;
    const tvFrom = Math.max(0, t - 19);
    for (let i = tvFrom; i <= t; i++) tv += bars[i].turnover;

    const s50 = sma(50, t), s200 = sma(200, t);
    if (t >= 209) {
      const then = sma(50, t - 10) - sma(200, t - 10);
      const now = s50 - s200;
      if (then <= 0 && now > 0) f.golden[t] = 1;
      else if (then >= 0 && now < 0) f.death[t] = 1;
    }

    m.close[t] = c[t];
    m.chg[t] = ret(t, 1);
    m.w1[t] = ret(t, 5); m.m1[t] = ret(t, 21); m.m3[t] = ret(t, 63);
    m.m6[t] = ret(t, 126); m.y1[t] = ret(t, 252);
    const raw = rsScore(m.m3[t], m.m6[t], ret(t, 189), m.y1[t]);
    if (raw != null) m.rs[t] = raw; // ranked across stocks in loadUniverse()
    m.fromHi[t] = pct(c[t], hi); m.fromLo[t] = pct(c[t], lo);
    m.vs20[t] = pct(c[t], sma(20, t)); m.vs50[t] = pct(c[t], s50); m.vs200[t] = pct(c[t], s200);
    if (bars[t].deliv != null) m.deliv[t] = bars[t].deliv;
    m.avgTurnover[t] = tv / (t - tvFrom + 1);
    if (t >= 119 && t > from) {
      if (bars[t].h >= priorHi) f.newHi[t] = 1;
      if (bars[t].l <= priorLo) f.newLo[t] = 1;
    }
  }
  return { m, f };
}

export async function loadUniverse({ log = () => {}, lookback = DEFAULT_LOOKBACK } = {}) {
  log(`Fetching up to ${lookback} calendar days of bhavcopies…`);
  const files = await fetchDays(log, lookback);
  await fetchExtras(log, lookback);
  const fund = await loadFundamentals();
  await fetchDerivatives(log, lookback);
  const deriv = await loadDerivatives();
  const results = await loadResults(); // downloaded by sync.mjs
  const master = new Set((await cachedList('EQUITY_L', 7, log)).map((r) => r.SYMBOL));
  const sectors = new Map(
    (await cachedList('ind_niftytotalmarket_list', 7, log)).map((r) => [r.Symbol, r.Industry]),
  );
  const membership = new Map();
  for (const [code, list] of INDEX_LISTS) {
    for (const r of await cachedList(list, 7, log)) membership.set(r.Symbol, code);
  }

  const etfList = await loadEtfList(log);

  log('Loading history…');
  const { bySymbol, dates } = await loadHistory(files);
  if (!dates.length) throw new Error('No bhavcopy data could be loaded');

  log('Computing indicators…');
  const symbols = [];
  for (const [symbol, days] of bySymbol) {
    // ETFs are loaded so the watchlist and paper account can follow them, but
    // flagged so screens, backtests and market statistics leave them out
    const etf = etfList.has(symbol);
    if (!master.has(symbol) && !etf) continue;
    const bars = [...days.values()].sort((a, b) => a.date - b.date);
    if (bars.length < MIN_BARS) continue;
    const events = adjust(bars, fund.actions.get(symbol) ?? [], fund.faceValue.get(symbol) ?? 0);
    const cols = columns(bars);
    Object.assign(cols.m, fundamentalSeries(symbol, bars, events, fund));
    Object.assign(cols.m, resultsSeries(symbol, bars, results));
    const ds = derivativeSeries(symbol, bars, deriv);
    Object.assign(cols.m, ds.m);
    Object.assign(cols.f, ds.f);
    Object.assign(cols.f, detectPatterns(bars).flags);
    symbols.push({
      s: symbol,
      etf,
      fo: ds.any,
      idx: membership.get(symbol) ?? null,
      sector: sectors.get(symbol) ?? null,
      n: bars.length,
      date: Int32Array.from(bars, (b) => b.date),
      o: Float64Array.from(bars, (b) => b.o),
      h: Float64Array.from(bars, (b) => b.h),
      l: Float64Array.from(bars, (b) => b.l),
      c: Float64Array.from(bars, (b) => b.c),
      ...cols,
    });
  }
  // relative strength: rank each session's raw scores across all stocks, 1-99
  const byDate = new Map();
  symbols.forEach((sym, si) => {
    for (let t = 0; t < sym.n; t++) {
      const raw = sym.m.rs[t];
      if (Number.isNaN(raw)) continue;
      if (sym.etf) { sym.m.rs[t] = NaN; continue; }
      (byDate.get(sym.date[t]) ?? byDate.set(sym.date[t], []).get(sym.date[t])).push([si * 4096 + t, raw]);
    }
  });
  for (const items of byDate.values()) {
    for (const [code, rank] of rankTo99(items)) symbols[Math.floor(code / 4096)].m.rs[code % 4096] = rank;
  }
  return { dates, symbols, deriv, base: new Map() };
}

export { baseline, compile, run } from './engine-core.mjs';
