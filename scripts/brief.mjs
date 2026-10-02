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
import { baseline, compile, loadUniverse } from './engine.mjs';
import { sync } from './sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER = path.join(ROOT, 'data/user');
const OUT = path.join(ROOT, 'public/data');
const HORIZONS = [5, 10, 20];
const LOOKBACK = 800; // calendar days: a year of indicators plus a year-ago P/E

export const DEFAULT_SCREENS = [
  {
    id: 'delivery',
    label: 'Delivery accumulation',
    filters: { flags: [], ranges: { deliv: [60, null], volX: [1.5, null], chg: [0, null], avgTurnover: [1, null] } },
  },
  {
    id: 'breakout-delivery',
    label: '52-week breakout with delivery',
    filters: { flags: ['newHi'], ranges: { deliv: [50, null], volX: [1.5, null], avgTurnover: [1, null] } },
  },
  {
    id: 'pullback-20dma',
    label: 'Pullback below 20-day average',
    filters: { flags: [], ranges: { vs20: [null, 0], rsi: [30, 50], y1: [0, null], avgTurnover: [5, null] } },
  },
];

const FILES = { watchlist: 'watchlist.json', screens: 'screens.json', log: 'log.json' };
const DEFAULTS = { watchlist: {}, screens: DEFAULT_SCREENS, log: [] };

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

export async function runBrief({ log = console.log, refresh = true } = {}) {
  const synced = refresh ? await sync({ log }) : null;
  log('Building the brief…');
  const universe = await loadUniverse({ lookback: LOOKBACK });
  const latest = universe.dates[universe.dates.length - 1];
  const bySymbol = new Map(universe.symbols.map((sym) => [sym.s, sym]));
  const screener = JSON.parse(await readFile(path.join(OUT, 'screener.json'), 'utf8'));
  const rowOf = new Map(screener.rows.map((r) => [r.s, r]));
  const [watchlist, screens, entries] = await Promise.all([readUser('watchlist'), readUser('screens'), readUser('log')]);

  const card = (s) => {
    const r = rowOf.get(s);
    const sym = bySymbol.get(s);
    if (!r || !sym) return null;
    let low10 = Infinity;
    for (let i = Math.max(0, sym.n - 10); i < sym.n; i++) low10 = Math.min(low10, sym.l[i]);
    return {
      s, name: r.name, close: r.close, chg: r.chg, volX: r.volX, deliv: r.deliv, rsi: r.rsi,
      vs50: r.vs50, vs200: r.vs200, fromHi: r.fromHi, hi52: r.hi52, low10: r2(low10),
      mcap: r.mcap, pe: r.pe, avgTurnover: r.avgTurnover, nextEx: r.nextEx,
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
