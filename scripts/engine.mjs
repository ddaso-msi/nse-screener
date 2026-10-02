// Backtest engine shared by the CLI (scripts/backtest.mjs) and the dev server's
// /api/backtest endpoint.
//
// Model: a stock "signals" on the first day it matches a screen (not on each
// following day it keeps matching). Entry is the next session's open. The
// trade exits at the stop-loss or target if one is set and touched, otherwise
// at the close `hold` sessions after the signal. Each trade is compared with
// the average liquid stock bought the same day and simply held for `hold`
// sessions, so a rising market doesn't flatter a screen.

import { derivativeSeries, fetchDerivatives, loadDerivatives } from './derivatives.mjs';
import { fetchExtras, fundamentalSeries, loadFundamentals } from './fundamentals.mjs';
import { PATTERNS, detectPatterns } from './patterns.mjs';
import { adjust, cachedList, fetchDays, loadHistory, rankTo99, rsScore } from './sync.mjs';

export const DEFAULT_LOOKBACK = 1100; // calendar days, ~3 years
const BASELINE_MIN_TURNOVER = 1; // ₹ Cr, same floor the preset screens use
const MIN_BARS = 30;

const METRICS = [
  'close', 'chg', 'w1', 'm1', 'm3', 'm6', 'y1', 'fromHi', 'fromLo',
  'vs20', 'vs50', 'vs200', 'rsi', 'volX', 'deliv', 'avgTurnover', 'rs',
  'mcap', 'pe', 'epsG', 'divY',
  'foOiChg', 'oi5', 'pcr', 'iv', 'ivRank',
];
// the rest are filled in by fundamentalSeries() and derivativeSeries()
const COMPUTED = METRICS.slice(0, METRICS.indexOf('mcap'));
const PRICE_FLAGS = ['newHi', 'newLo', 'golden', 'death'];
const FLAGS = [...PRICE_FLAGS, 'longBuild', 'shortBuild', 'shortCover', 'longUnwind', ...PATTERNS];
const INDEX_LISTS = [
  ['N50', 'ind_nifty50list'],
  ['NN50', 'ind_niftynext50list'],
  ['MID150', 'ind_niftymidcap150list'],
  ['SML250', 'ind_niftysmallcap250list'],
  ['MIC250', 'ind_niftymicrocap250_list'],
];
const UNIVERSES = {
  N50: (i) => i === 'N50',
  NN50: (i) => i === 'NN50',
  N100: (i) => i === 'N50' || i === 'NN50',
  MID150: (i) => i === 'MID150',
  SML250: (i) => i === 'SML250',
  N500: (i) => i != null && i !== 'MIC250',
  MIC250: (i) => i === 'MIC250',
  OTHER: (i) => i == null,
  FNO: (i, sym) => sym.fo,
};

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
  const master = new Set((await cachedList('EQUITY_L', 7, log)).map((r) => r.SYMBOL));
  const sectors = new Map(
    (await cachedList('ind_niftytotalmarket_list', 7, log)).map((r) => [r.Symbol, r.Industry]),
  );
  const membership = new Map();
  for (const [code, list] of INDEX_LISTS) {
    for (const r of await cachedList(list, 7, log)) membership.set(r.Symbol, code);
  }

  log('Loading history…');
  const { bySymbol, dates } = await loadHistory(files);
  if (!dates.length) throw new Error('No bhavcopy data could be loaded');

  log('Computing indicators…');
  const symbols = [];
  for (const [symbol, days] of bySymbol) {
    if (!master.has(symbol)) continue; // ETFs, bonds etc.
    const bars = [...days.values()].sort((a, b) => a.date - b.date);
    if (bars.length < MIN_BARS) continue;
    const events = adjust(bars, fund.actions.get(symbol) ?? [], fund.faceValue.get(symbol) ?? 0);
    const cols = columns(bars);
    Object.assign(cols.m, fundamentalSeries(symbol, bars, events, fund));
    const ds = derivativeSeries(symbol, bars, deriv);
    Object.assign(cols.m, ds.m);
    Object.assign(cols.f, ds.f);
    Object.assign(cols.f, detectPatterns(bars).flags);
    symbols.push({
      s: symbol,
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
      (byDate.get(sym.date[t]) ?? byDate.set(sym.date[t], []).get(sym.date[t])).push([si * 4096 + t, raw]);
    }
  });
  for (const items of byDate.values()) {
    for (const [code, rank] of rankTo99(items)) symbols[Math.floor(code / 4096)].m.rs[code % 4096] = rank;
  }
  return { dates, symbols, deriv, base: new Map() };
}

// date -> average buy-and-hold return of every liquid stock over `hold` sessions
export function baseline(universe, hold) {
  let cached = universe.base.get(hold);
  if (cached) return cached;
  const acc = new Map();
  for (const sym of universe.symbols) {
    for (let t = 0; t + hold < sym.n; t++) {
      if (!(sym.m.avgTurnover[t] >= BASELINE_MIN_TURNOVER) || !(sym.o[t + 1] > 0)) continue;
      const a = acc.get(sym.date[t]) ?? acc.set(sym.date[t], [0, 0]).get(sym.date[t]);
      a[0] += pct(sym.c[t + hold], sym.o[t + 1]);
      a[1]++;
    }
  }
  cached = new Map([...acc].map(([d, [sum, n]]) => [d, sum / n]));
  universe.base.set(hold, cached);
  return cached;
}

export function compile(filters = {}) {
  const flags = (filters.flags ?? []).filter((k) => FLAGS.includes(k));
  const ranges = Object.entries(filters.ranges ?? {})
    .filter(([k, r]) => METRICS.includes(k) && Array.isArray(r) && (r[0] != null || r[1] != null))
    .map(([k, [min, max]]) => [k, min ?? -Infinity, max ?? Infinity]);
  const inUniverse = UNIVERSES[filters.universe] ?? (() => true);
  return {
    empty: !flags.length && !ranges.length,
    symbol: (sym) => inUniverse(sym.idx, sym) && (!filters.sector || sym.sector === filters.sector),
    row(sym, t) {
      for (const k of flags) if (!sym.f[k][t]) return false;
      for (const [k, min, max] of ranges) {
        const v = sym.m[k][t];
        if (!(v >= min && v <= max)) return false; // NaN fails
      }
      return true;
    },
  };
}

// Walks the trade forward from the entry bar. A stop and a target touched on
// the same day count as the stop (the conservative reading of a daily bar);
// a gap through either level fills at the open.
function simulate(sym, t, hold, stop, target) {
  const entry = sym.o[t + 1];
  const stopPx = stop != null ? entry * (1 - stop / 100) : null;
  const targetPx = target != null ? entry * (1 + target / 100) : null;
  if (stopPx != null || targetPx != null) {
    for (let d = t + 1; d <= t + hold; d++) {
      if (stopPx != null && sym.l[d] <= stopPx) {
        return { ret: pct(d > t + 1 ? Math.min(sym.o[d], stopPx) : stopPx, entry), exit: 'stop', held: d - t };
      }
      if (targetPx != null && sym.h[d] >= targetPx) {
        return { ret: pct(d > t + 1 ? Math.max(sym.o[d], targetPx) : targetPx, entry), exit: 'target', held: d - t };
      }
    }
  }
  return { ret: pct(sym.c[t + hold], entry), exit: 'time', held: hold };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const quarterOf = (date) => `${Math.floor(date / 10000)} Q${Math.ceil((Math.floor(date / 100) % 100) / 3)}`;

/**
 * @param universe from loadUniverse()
 * @param opts.filters  same shape as the app's Filters (flags, ranges, universe, sector)
 * @param opts.hold     sessions to hold if no exit is hit
 * @param opts.stop     stop-loss, % below entry (null = none)
 * @param opts.target   profit target, % above entry (null = none)
 * @param opts.cost     round-trip costs in %, subtracted from every trade
 * @param opts.from/to  only count signals dated in this range (YYYYMMDD)
 * @returns stats, or null when no signal completed
 */
export function run(universe, { filters, hold = 10, stop = null, target = null, cost = 0, from = 0, to = Infinity }) {
  const test = compile(filters);
  if (test.empty) throw new Error('Set at least one criterion to backtest.');
  const base = baseline(universe, hold);
  const trades = [];
  let matching = 0;

  for (const sym of universe.symbols) {
    if (!test.symbol(sym)) continue;
    let was = false;
    for (let t = 0; t < sym.n; t++) {
      const hit = test.row(sym, t);
      const d = sym.date[t];
      if (hit && !was && t > 0 && d >= from && d <= to && t + hold < sym.n && sym.o[t + 1] > 0 && base.has(d)) {
        const tr = simulate(sym, t, hold, stop, target);
        trades.push({ date: sym.date[t], ret: tr.ret - cost, base: base.get(sym.date[t]), exit: tr.exit, held: tr.held });
      }
      was = hit;
    }
    if (was) matching++;
  }
  if (!trades.length) return null;

  const rets = trades.map((x) => x.ret);
  const excess = trades.map((x) => x.ret - x.base);
  // t-stat on per-day average excess, so one crowded day counts once
  const perDay = new Map();
  const quarters = new Map();
  trades.forEach((x, j) => {
    (perDay.get(x.date) ?? perDay.set(x.date, []).get(x.date)).push(excess[j]);
    const q = quarterOf(x.date);
    (quarters.get(q) ?? quarters.set(q, []).get(q)).push(excess[j]);
  });
  const daily = [...perDay.values()].map(mean);
  const dm = mean(daily);
  const sd = Math.sqrt(daily.reduce((s, x) => s + (x - dm) ** 2, 0) / Math.max(1, daily.length - 1));
  const sorted = [...rets].sort((a, b) => a - b);
  const gains = rets.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const losses = -rets.filter((r) => r < 0).reduce((s, r) => s + r, 0);
  const share = (kind) => r2((trades.filter((x) => x.exit === kind).length / trades.length) * 100);

  return {
    n: trades.length,
    days: daily.length,
    mean: r2(mean(rets)),
    median: r2(quantile(sorted, 0.5)),
    win: r2((rets.filter((r) => r > 0).length / rets.length) * 100),
    base: r2(mean(trades.map((x) => x.base))),
    excess: r2(mean(excess)),
    beat: r2((excess.filter((e) => e > 0).length / excess.length) * 100),
    p10: r2(quantile(sorted, 0.1)),
    p90: r2(quantile(sorted, 0.9)),
    t: daily.length > 1 && sd > 0 ? r2(dm / (sd / Math.sqrt(daily.length))) : null,
    profitFactor: losses > 0 ? r2(gains / losses) : null,
    held: r2(mean(trades.map((x) => x.held))),
    stopped: share('stop'),
    targeted: share('target'),
    matching,
    quarters: [...quarters].sort().map(([q, e]) => ({ q, n: e.length, excess: r2(mean(e)) })),
  };
}
