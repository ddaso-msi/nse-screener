// Evening brief: refreshes the data, finds what newly matched each screen,
// reports on the watchlist, and keeps a forward log of every new match.
//
//   node scripts/brief.mjs            refresh data, then build the brief
//   node scripts/brief.mjs --no-sync  build from data already on disk
//
// The forward log (data/user/log.json) only ever records matches on the day
// they happen, then fills in what the price did afterwards. Unlike a backtest
// it cannot be flattered by hindsight, so it is never backfilled.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexPositioning } from './derivatives.mjs';
import { baseline, compile, loadUniverse } from './engine.mjs';
import { sync } from './sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER = path.join(ROOT, 'data/user');
const OUT = path.join(ROOT, 'public/data');
const HORIZONS = [5, 10, 20];
const LOOKBACK = 800; // calendar days: a year of indicators plus a year-ago P/E

// also served by functions/api/user/[name].js when nothing has been saved yet
export const DEFAULT_SCREENS = JSON.parse(
  await readFile(path.join(ROOT, 'scripts/default-screens.json'), 'utf8'),
);

const FILES = { watchlist: 'watchlist.json', screens: 'screens.json', log: 'log.json', paper: 'paper.json', drawings: 'drawings.json' };
export const PAPER_START = 1000000;
const DEFAULTS = {
  watchlist: {},
  screens: DEFAULT_SCREENS,
  log: [],
  drawings: {},
  paper: { start: PAPER_START, cash: PAPER_START, orders: [], positions: [], closed: [], equity: [], notices: [], last: null },
};
const PAPER_FEE = 0.0015; // brokerage, STT and slippage, charged on each side

export async function readUser(name) {
  try {
    return JSON.parse(await readFile(path.join(USER, FILES[name]), 'utf8'));
  } catch {
    return structuredClone(DEFAULTS[name]);
  }
}
export async function writeUser(name, value) {
  await mkdir(USER, { recursive: true });
  await writeFile(path.join(USER, FILES[name]), JSON.stringify(value, null, 2));
}

const pct = (a, b) => (b ? (a / b - 1) * 100 : null);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => {
  const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const share = (a, test) => (a.length ? (a.filter(test).length / a.length) * 100 : null);

const GROUPS = [
  ['Nifty 50', (i) => i === 'N50'],
  ['Nifty Next 50', (i) => i === 'NN50'],
  ['Midcap 150', (i) => i === 'MID150'],
  ['Smallcap 250', (i) => i === 'SML250'],
  ['Microcap 250', (i) => i === 'MIC250'],
  ['All liquid stocks', () => true],
];
const HISTORY_SESSIONS = 250;
const LIQUID = 1; // ₹ Cr average daily turnover

// Breadth and leadership across liquid stocks: how many are in an uptrend, which
// size groups and sectors are leading. Uses the median stock, not an index level.
function marketContext(universe) {
  const { dates } = universe;
  const latest = dates[dates.length - 1];
  const at = new Map(dates.map((d, i) => [d, i]));
  const from = Math.max(0, dates.length - HISTORY_SESSIONS);
  const hist = Array.from({ length: dates.length - from }, () => ({ n: 0, n50: 0, a50: 0, n200: 0, a200: 0, hi: 0, lo: 0 }));
  const today = [];

  for (const sym of universe.symbols) {
    for (let t = sym.n - 1; t >= 0; t--) {
      const i = at.get(sym.date[t]) - from;
      if (i < 0) break;
      if (!(sym.m.avgTurnover[t] >= LIQUID)) continue;
      const h = hist[i];
      h.n++;
      if (!Number.isNaN(sym.m.vs50[t])) { h.n50++; if (sym.m.vs50[t] > 0) h.a50++; }
      if (!Number.isNaN(sym.m.vs200[t])) { h.n200++; if (sym.m.vs200[t] > 0) h.a200++; }
      h.hi += sym.f.newHi[t];
      h.lo += sym.f.newLo[t];
    }
    const t = sym.n - 1;
    if (sym.date[t] === latest && sym.m.avgTurnover[t] >= LIQUID) {
      const m = sym.m;
      today.push({ idx: sym.idx, sector: sym.sector, chg: m.chg[t], w1: m.w1[t], m1: m.m1[t], m3: m.m3[t], vs50: m.vs50[t], vs200: m.vs200[t] });
    }
  }

  const summarise = (list) => ({
    n: list.length,
    chg: r2(median(list.map((x) => x.chg))),
    w1: r2(median(list.map((x) => x.w1))),
    m1: r2(median(list.map((x) => x.m1))),
    m3: r2(median(list.map((x) => x.m3))),
    above50: r2(share(list.filter((x) => Number.isFinite(x.vs50)), (x) => x.vs50 > 0)),
    above200: r2(share(list.filter((x) => Number.isFinite(x.vs200)), (x) => x.vs200 > 0)),
  });
  const sectors = new Map();
  for (const x of today) if (x.sector) (sectors.get(x.sector) ?? sectors.set(x.sector, []).get(x.sector)).push(x);
  const pctOf = (a, n) => (n ? r2((a / n) * 100) : null);
  const last = hist[hist.length - 1];
  const monthAgo = hist[Math.max(0, hist.length - 22)];

  return {
    liquid: today.length,
    above50: pctOf(last.a50, last.n50),
    above200: pctOf(last.a200, last.n200),
    above200MonthAgo: pctOf(monthAgo.a200, monthAgo.n200),
    above50MonthAgo: pctOf(monthAgo.a50, monthAgo.n50),
    newHi: last.hi,
    newLo: last.lo,
    advancers: today.filter((x) => x.chg > 0).length,
    decliners: today.filter((x) => x.chg < 0).length,
    medianChg: r2(median(today.map((x) => x.chg))),
    groups: GROUPS.map(([label, has]) => ({ label, ...summarise(today.filter((x) => has(x.idx))) })),
    sectors: [...sectors]
      .filter(([, list]) => list.length >= 5)
      .map(([sector, list]) => ({ sector, ...summarise(list) }))
      .sort((a, b) => (b.m1 ?? -Infinity) - (a.m1 ?? -Infinity)),
    history: {
      d: dates.slice(from),
      a50: hist.map((h) => pctOf(h.a50, h.n50)),
      a200: hist.map((h) => pctOf(h.a200, h.n200)),
      hi: hist.map((h) => h.hi),
      lo: hist.map((h) => h.lo),
    },
  };
}

/**
 * Moves the paper-trading account forward to the latest session, one session
 * at a time: orders fill at the next session's open, then stops and targets
 * are checked against each day's range (a stop and a target touched on the
 * same day count as the stop; a gap through a level fills at the open).
 */
export function processPaper(paper, universe) {
  const { dates } = universe;
  const latest = dates[dates.length - 1];
  const bySymbol = new Map(universe.symbols.map((sym) => [sym.s, sym]));
  const round = (x) => Math.round(x * 100) / 100;
  paper.notices ??= [];
  const nifty = (d) => universe.deriv?.idx.get(d)?.['Nifty 50']?.close ?? null;
  if (paper.last == null) {
    paper.last = latest;
    paper.equity = [{ date: latest, value: paper.cash, nifty: nifty(latest) }];
    return paper;
  }

  // a split or bonus since entry changes the price scale: restate the position to match
  for (const p of paper.positions) {
    const sym = bySymbol.get(p.s);
    const i = sym ? sym.date.indexOf(p.entryDate) : -1;
    if (i < 0 || !p.ref) continue;
    const k = sym.c[i] / p.ref;
    if (Math.abs(k - 1) > 0.005) {
      p.entry = round(p.entry * k);
      if (p.stop) p.stop = round(p.stop * k);
      if (p.target) p.target = round(p.target * k);
      p.qty = Math.round(p.qty / k);
      p.ref = sym.c[i];
    }
  }

  const close = (p, price, date, reason) => {
    const proceeds = price * p.qty * (1 - PAPER_FEE);
    const cost = p.entry * p.qty * (1 + PAPER_FEE);
    paper.cash = round(paper.cash + proceeds);
    paper.closed.unshift({
      s: p.s, qty: p.qty, entry: p.entry, entryDate: p.entryDate, exit: round(price), exitDate: date, reason,
      pnl: round(proceeds - cost), pct: round((proceeds / cost - 1) * 100), note: p.note ?? '',
    });
    paper.positions = paper.positions.filter((x) => x !== p);
  };

  for (const d of dates.filter((x) => x > paper.last)) {
    for (const p of [...paper.positions]) {
      const sym = bySymbol.get(p.s);
      const t = sym ? sym.date.indexOf(d) : -1;
      if (t < 0) continue; // not traded that day
      if (p.sell && p.sell < d) close(p, sym.o[t], d, 'Sold at the open');
      else if (p.stop && sym.o[t] <= p.stop) close(p, sym.o[t], d, 'Stop hit on a gap down');
      else if (p.stop && sym.l[t] <= p.stop) close(p, p.stop, d, 'Stop hit');
      else if (p.target && sym.o[t] >= p.target) close(p, sym.o[t], d, 'Target hit on a gap up');
      else if (p.target && sym.h[t] >= p.target) close(p, p.target, d, 'Target hit');
    }
    for (const o of [...paper.orders]) {
      if (o.placed >= d) continue;
      const sym = bySymbol.get(o.s);
      const t = sym ? sym.date.indexOf(d) : -1;
      if (t < 0) continue;
      paper.orders = paper.orders.filter((x) => x !== o);
      const price = sym.o[t];
      const qty = Math.min(o.qty, Math.floor(paper.cash / (price * (1 + PAPER_FEE))));
      if (qty <= 0) {
        paper.notices.unshift({ date: d, text: `${o.s}: order not filled, not enough cash` });
        continue;
      }
      if (qty < o.qty) paper.notices.unshift({ date: d, text: `${o.s}: bought ${qty} of ${o.qty}, cash ran out` });
      paper.cash = round(paper.cash - price * qty * (1 + PAPER_FEE));
      const pos = { id: o.id, s: o.s, qty, entry: round(price), entryDate: d, ref: sym.c[t], stop: o.stop ?? null, target: o.target ?? null, note: o.note ?? '' };
      paper.positions.push(pos);
      if (pos.stop && sym.l[t] <= pos.stop) close(pos, pos.stop, d, 'Stop hit');
      else if (pos.target && sym.h[t] >= pos.target) close(pos, pos.target, d, 'Target hit');
    }
    let value = paper.cash;
    for (const p of paper.positions) {
      const sym = bySymbol.get(p.s);
      let t = sym ? sym.n - 1 : -1;
      while (t >= 0 && sym.date[t] > d) t--;
      value += p.qty * (t >= 0 ? sym.c[t] : p.entry);
    }
    paper.equity.push({ date: d, value: round(value), nifty: nifty(d) });
  }
  paper.notices = paper.notices.slice(0, 12);
  paper.last = latest;
  return paper;
}

export async function runBrief({ log = console.log, refresh = true } = {}) {
  const synced = refresh ? await sync({ log }) : null;
  log('Building the brief…');
  const universe = await loadUniverse({ lookback: LOOKBACK });
  const latest = universe.dates[universe.dates.length - 1];
  const bySymbol = new Map(universe.symbols.map((sym) => [sym.s, sym]));
  const screener = JSON.parse(await readFile(path.join(OUT, 'screener.json'), 'utf8'));
  const rowOf = new Map(screener.rows.map((r) => [r.s, r]));
  const [watchlist, screens, entries] = await Promise.all([readUser('watchlist'), readUser('screens'), readUser('log')]);
  const paper = processPaper(await readUser('paper'), universe);
  await writeUser('paper', paper);

  const card = (s) => {
    const r = rowOf.get(s);
    const sym = bySymbol.get(s);
    if (!r || !sym) return null;
    let low10 = Infinity;
    for (let i = Math.max(0, sym.n - 10); i < sym.n; i++) low10 = Math.min(low10, sym.l[i]);
    return {
      s, name: r.name, close: r.close, chg: r.chg, volX: r.volX, deliv: r.deliv, rsi: r.rsi, rs: r.rs,
      vs50: r.vs50, vs200: r.vs200, fromHi: r.fromHi, hi52: r.hi52, low10: r2(low10),
      mcap: r.mcap, pe: r.pe, avgTurnover: r.avgTurnover, nextEx: r.nextEx,
      foOiChg: r.foOiChg, build: r.build, bm: r.bm,
    };
  };

  // --- what newly matched, what dropped off
  const known = new Set(entries.map((e) => e.id));
  const newBySymbol = new Map();
  const screenOut = screens.map((screen) => {
    const test = compile(screen.filters);
    const fresh = [], dropped = [];
    let total = 0;
    if (!test.empty) {
      for (const sym of universe.symbols) {
        const t = sym.n - 1;
        if (sym.date[t] !== latest || t < 1 || !test.symbol(sym)) continue;
        const now = test.row(sym, t);
        const before = test.row(sym, t - 1);
        if (now) total++;
        if (now && !before) fresh.push(sym.s);
        else if (!now && before) dropped.push(sym.s);
      }
    }
    for (const s of fresh) {
      (newBySymbol.get(s) ?? newBySymbol.set(s, []).get(s)).push(screen.label);
      const id = `${latest}|${screen.id}|${s}`;
      if (!known.has(id)) entries.push({ id, date: latest, screen: screen.id, label: screen.label, s });
    }
    return {
      id: screen.id,
      label: screen.label,
      filters: screen.filters,
      total,
      fresh: fresh.map(card).filter(Boolean).sort((a, b) => (b.avgTurnover ?? 0) - (a.avgTurnover ?? 0)),
      dropped: dropped.sort(),
    };
  });

  // --- forward log: fill in what happened after each recorded match
  for (const e of entries) {
    const sym = bySymbol.get(e.s);
    const t = sym ? sym.date.indexOf(e.date) : -1;
    if (t < 0) continue;
    e.close = r2(sym.c[t]);
    if (t + 1 < sym.n) e.entry = r2(sym.o[t + 1]);
    e.last = r2(pct(sym.c[sym.n - 1], t + 1 < sym.n ? sym.o[t + 1] : sym.c[t]));
    for (const h of HORIZONS) {
      if (t + h < sym.n && sym.o[t + 1] > 0) {
        e[`r${h}`] = r2(pct(sym.c[t + h], sym.o[t + 1]));
        e[`m${h}`] = r2(baseline(universe, h).get(e.date) ?? null);
      }
    }
  }
  await writeUser('log', entries);

  const labels = new Map(entries.map((e) => [e.screen, e.label]));
  const scoreboard = [...labels].map(([id, label]) => {
    const mine = entries.filter((e) => e.screen === id);
    const row = { id, label, logged: mine.length };
    for (const h of HORIZONS) {
      const done = mine.filter((e) => e[`r${h}`] != null && e[`m${h}`] != null);
      row[`h${h}`] = done.length
        ? {
            n: done.length,
            avg: r2(mean(done.map((e) => e[`r${h}`]))),
            market: r2(mean(done.map((e) => e[`m${h}`]))),
            win: r2((done.filter((e) => e[`r${h}`] > 0).length / done.length) * 100),
          }
        : null;
    }
    return row;
  });

  // --- watchlist
  const watch = Object.entries(watchlist).map(([s, item]) => {
    const c = card(s);
    const sym = bySymbol.get(s);
    const r = rowOf.get(s);
    if (!c || !sym || !r) return { s, note: item.note ?? '', level: item.level ?? null, missing: true, alerts: [] };
    const t = sym.n - 1;
    const alerts = [];
    const level = item.level;
    if (level > 0 && t > 0) {
      if (sym.c[t - 1] < level && sym.c[t] >= level) alerts.push({ kind: 'up', text: `Closed above your level of ₹${level}` });
      else if (sym.c[t - 1] > level && sym.c[t] <= level) alerts.push({ kind: 'down', text: `Closed below your level of ₹${level}` });
    }
    if (r.newHi) alerts.push({ kind: 'up', text: 'New 52-week high' });
    if (r.newLo) alerts.push({ kind: 'down', text: 'New 52-week low' });
    if (r.cross === 1) alerts.push({ kind: 'up', text: 'Golden cross in the last 10 sessions' });
    if (r.cross === -1) alerts.push({ kind: 'down', text: 'Death cross in the last 10 sessions' });
    if (Math.abs(r.chg ?? 0) >= 4) alerts.push({ kind: r.chg > 0 ? 'up' : 'down', text: `Moved ${r.chg > 0 ? '+' : '−'}${Math.abs(r.chg).toFixed(1)}% today` });
    if (r.volX >= 2) alerts.push({ kind: 'info', text: `Volume ${r.volX.toFixed(1)}× its 20-day average` });
    for (const label of newBySymbol.get(s) ?? []) alerts.push({ kind: 'info', text: `Newly matched "${label}"` });
    if (r.bm) alerts.push({ kind: 'info', text: `Board meeting on ${r.bm.date}: ${r.bm.purpose}`, ex: r.bm.date });
    for (const subject of r.filed ?? []) alerts.push({ kind: 'info', text: `Filed today: ${subject}` });
    if (r.build) alerts.push({ kind: r.build === 'LB' || r.build === 'SC' ? 'up' : 'down', text: `${{ LB: 'Long build-up', SB: 'Short build-up', SC: 'Short covering', LU: 'Long unwinding' }[r.build]} in futures (open interest ${r.foOiChg > 0 ? '+' : '−'}${Math.abs(r.foOiChg).toFixed(1)}%)` });
    if (r.ban) alerts.push({ kind: 'down', text: 'In the F&O ban period' });
    if (r.nextEx) alerts.push({ kind: 'info', text: `${r.nextEx.text}, ex-date ${r.nextEx.ex}`, ex: r.nextEx.ex });
    const at = item.added ? sym.date.findIndex((d) => d >= item.added) : -1;
    return {
      ...c,
      note: item.note ?? '',
      level: level ?? null,
      toLevel: level > 0 ? r2(pct(level, sym.c[t])) : null,
      added: item.added ?? null,
      sinceAdded: at >= 0 && at < t ? r2(pct(sym.c[t], sym.c[at])) : null,
      alerts,
    };
  });
  watch.sort((a, b) => b.alerts.length - a.alerts.length || a.s.localeCompare(b.s));

  const brief = {
    asOf: latest,
    generatedAt: new Date().toISOString(),
    market: { ...marketContext(universe), deriv: indexPositioning(universe.deriv, latest) },
    screens: screenOut,
    watchlist: watch,
    scoreboard,
    log: [...entries].sort((a, b) => b.date - a.date || a.s.localeCompare(b.s)).slice(0, 400),
    logTotal: entries.length,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'brief.json'), JSON.stringify(brief));
  await mkdir(path.join(USER, 'briefs'), { recursive: true });
  await writeFile(path.join(USER, 'briefs', `${latest}.json`), JSON.stringify(brief));
  log(
    `Brief for ${latest}: ` +
      screenOut.map((s) => `${s.label} ${s.fresh.length} new`).join(', ') +
      `; ${watch.length} on watchlist; ${entries.length} matches logged`,
  );
  return { ...(synced ?? { asOf: latest }), brief: { asOf: latest, logged: entries.length } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBrief({ refresh: !process.argv.includes('--no-sync') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
