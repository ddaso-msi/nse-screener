// The backtest engine proper: no file or network access, so the same code runs
// in Node (scripts/engine.mjs builds its input from the NSE files) and in the
// browser (src/backtestClient.ts builds it from the packed files in
// public/data/bt).
//
// Input: a "universe" { dates, symbols, base: Map }, where each symbol is
// { s, idx, sector, fo, etf, n, date[], o[], h[], l[], c[], m: {metric: []}, f: {flag: []} }
// with one array entry per session that stock traded.
//
// Model: a stock "signals" on the first day it matches a screen (not on each
// following day it keeps matching). Entry is the next session's open. The
// trade exits at the stop-loss or target if one is set and touched, otherwise
// at the close `hold` sessions after the signal. Each trade is compared with
// the average liquid stock bought the same day and simply held for `hold`
// sessions, so a rising market doesn't flatter a screen.

import { PATTERNS } from './patterns.mjs';

const BASELINE_MIN_TURNOVER = 1; // ₹ Cr, same floor the preset screens use

export const METRICS = [
  'close', 'chg', 'w1', 'm1', 'm3', 'm6', 'y1', 'fromHi', 'fromLo',
  'vs20', 'vs50', 'vs200', 'rsi', 'volX', 'deliv', 'avgTurnover', 'rs',
  'mcap', 'pe', 'epsG', 'divY',
  'revYoY', 'patYoY', 'opm', 'roe', 'de',
  'foOiChg', 'oi5', 'pcr', 'iv', 'ivRank',
];
export const PRICE_FLAGS = ['newHi', 'newLo', 'golden', 'death'];
export const FLAGS = [...PRICE_FLAGS, 'longBuild', 'shortBuild', 'shortCover', 'longUnwind', ...PATTERNS];
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

// date -> average buy-and-hold return of every liquid stock over `hold` sessions
export function baseline(universe, hold) {
  let cached = universe.base.get(hold);
  if (cached) return cached;
  const acc = new Map();
  for (const sym of universe.symbols) {
    if (sym.etf) continue;
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
    symbol: (sym) => !sym.etf && inUniverse(sym.idx, sym) && (!filters.sector || sym.sector === filters.sector),
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
