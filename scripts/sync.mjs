// Downloads NSE end-of-day bhavcopies (official archive), computes screener
// metrics for every listed company, and writes static JSON into public/data.
//
//   node scripts/sync.mjs          incremental (only missing days are fetched)
//
// Raw files are cached in data/raw so re-runs only fetch new sessions.

import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchExtras, fundamentalSeries, loadFundamentals } from './fundamentals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const LOOKBACK_CALENDAR_DAYS = 420; // ~285 sessions: enough for 200-DMA + 52-week range
const SERIES = new Set(['EQ', 'BE', 'BZ']);
const CONCURRENCY = 4;

const INDICES = [
  ['N50', 'Nifty 50', 'ind_nifty50list'],
  ['NN50', 'Nifty Next 50', 'ind_niftynext50list'],
  ['MID150', 'Nifty Midcap 150', 'ind_niftymidcap150list'],
  ['SML250', 'Nifty Smallcap 250', 'ind_niftysmallcap250list'],
  ['MIC250', 'Nifty Microcap 250', 'ind_niftymicrocap250_list'],
];
const SECTOR_LIST = 'ind_niftytotalmarket_list';

const pad = (n) => String(n).padStart(2, '0');
const exists = (p) => stat(p).then(() => true, () => false);

async function get(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(',').map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((s) => s.trim());
    const row = {};
    head.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

export async function cachedList(name, maxAgeDays, log) {
  const file = path.join(RAW, 'lists', `${name}.csv`);
  const fresh =
    (await exists(file)) && Date.now() - (await stat(file)).mtimeMs < maxAgeDays * 864e5;
  if (!fresh) {
    try {
      const dir = name === 'EQUITY_L' ? 'equities' : 'indices';
      const text = await get(`https://archives.nseindia.com/content/${dir}/${name}.csv`);
      if (text && !text.startsWith('<')) await writeFile(file, text);
    } catch (err) {
      log(`  list ${name} not refreshed (${err.message})`);
    }
  }
  return (await exists(file)) ? parseCsv(await readFile(file, 'utf8')) : [];
}

export async function fetchDays(log, lookback = LOOKBACK_CALENDAR_DAYS) {
  const missFile = path.join(RAW, 'misses.json');
  const misses = new Set((await exists(missFile)) ? JSON.parse(await readFile(missFile, 'utf8')) : []);
  const istNow = new Date(Date.now() + 5.5 * 36e5);
  const todo = [];
  const files = [];
  for (let i = 0; i < lookback; i++) {
    const d = new Date(istNow.getTime() - i * 864e5);
    const tag = `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
    const file = path.join(RAW, `${tag}.csv`);
    files.push(file);
    if (misses.has(tag) || (await exists(file))) continue;
    todo.push({ tag, file, age: i });
  }
  let done = 0;
  const worker = async () => {
    for (let job; (job = todo.shift()); ) {
      const text = await get(
        `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${job.tag}.csv`,
      );
      // On non-trading days the archive 404s or re-serves an older session; keep
      // only files whose rows carry the requested date. Weekends are still tried
      // because NSE runs occasional special sessions (e.g. Budget day).
      if (text && text.startsWith('SYMBOL') && sessionTag(text) === job.tag) {
        await writeFile(job.file, text);
      } else if (job.age > 3) misses.add(job.tag); // recent gaps are retried
      if (++done % 25 === 0) log(`  fetched ${done} day files…`);
    }
  };
  const total = todo.length;
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(missFile, JSON.stringify([...misses]));
  log(`  ${total} day file(s) requested, ${misses.size} known non-trading days`);
  return files;
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
// "30-Sep-2026" -> 20260930
const dateKey = (s) => {
  const [d, m, y] = s.split('-');
  return Number(y) * 10000 + MONTHS[m] * 100 + Number(d);
};

// DDMMYYYY of the first data row in a bhavcopy
function sessionTag(text) {
  const row = text.slice(text.indexOf('\n') + 1, text.indexOf('\n', text.indexOf('\n') + 1));
  const [d, m, y] = (row.split(',')[2] ?? '').trim().split('-');
  return `${d}${pad(MONTHS[m])}${y}`;
}

export async function loadHistory(files) {
  const bySymbol = new Map();
  const dates = new Set();
  for (const file of files) {
    if (!(await exists(file))) continue;
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length < 15) continue;
      const series = c[1].trim();
      if (!SERIES.has(series)) continue;
      const date = dateKey(c[2].trim());
      const close = +c[8];
      if (!(close > 0)) continue;
      dates.add(date);
      const symbol = c[0].trim();
      let days = bySymbol.get(symbol);
      if (!days) bySymbol.set(symbol, (days = new Map()));
      // the archive occasionally serves the same session under two dates; keep one per day
      if (days.has(date) && series !== 'EQ') continue;
      days.set(date, {
        date,
        series,
        prev: +c[3],
        o: +c[4],
        h: +c[5],
        l: +c[6],
        c: close,
        v: +c[10],
        turnover: +c[11] / 100, // lakhs -> crore
        deliv: Number.isFinite(+c[14]) ? +c[14] : null,
      });
    }
  }
  return { bySymbol, dates: [...dates].sort((a, b) => a - b) };
}

// Bhavcopy prices are unadjusted, so earlier bars are scaled at each split,
// bonus, rights issue and demerger. Official NSE corporate actions drive this:
//   split / bonus  exact ratio from the announcement
//   rights         theoretical ex-rights price from the ratio and issue price
//   demerger       the announcement carries no ratio, so the opening gap is used
// If a stock opens more than 23% below the previous close with no official
// action on record (further than a price band allows), it is still treated as
// a corporate action and marked "inferred". The test is on the open, not the
// close, because real crashes (IndusInd Mar 2025, PFC/REC on 4 Jun 2024) open
// around -10% and fall from there. Dividends are not adjusted.
const CA_RATIOS = [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4, 1 / 5, 2 / 5, 3 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 20];
const CA_THRESHOLD = 0.77;

const near = (seen, ratio) => Math.abs(seen / ratio - 1) <= Math.min(0.2, (1 - ratio) * 0.6);

// Decides which bar each official action lands on. Ex-dates get revised and the
// archive keeps both versions, so a split or bonus is only applied where the
// opening gap confirms it: on its stated ex-date, or failing that within five
// sessions either side. Returns Map(barIndex -> [{ ratio, kind, text }]).
function planActions(bars, actions, faceValue) {
  const plan = new Map();
  const add = (i, ev) => (plan.get(i) ?? plan.set(i, []).get(i)).push(ev);
  const barOn = (ex) => {
    const i = bars.findIndex((b) => b.date >= ex);
    return i > 0 ? i : -1; // -1: before our history, or not reached yet
  };
  const seenAt = (i) => bars[i].o / bars[i - 1].c;

  // splits and bonuses with a known ratio, combined per ex-date
  const groups = new Map();
  for (const a of actions) {
    if ((a.kind !== 'split' && a.kind !== 'bonus') || a.ratio == null) continue;
    const g = groups.get(a.ex) ?? groups.set(a.ex, []).get(a.ex);
    if (!g.some((x) => x.text === a.text && x.kind === a.kind)) g.push(a);
  }
  const used = new Set();
  const pending = [];
  for (const [ex, g] of groups) {
    const i = barOn(ex);
    if (i < 0) continue;
    const ratio = g.reduce((r, a) => r * a.ratio, 1);
    if (near(seenAt(i), ratio) && !used.has(i)) {
      used.add(i);
      for (const a of g) add(i, { ratio: a.ratio, kind: a.kind, text: a.text });
    } else pending.push({ i, g, ratio });
  }
  for (const { i, g, ratio } of pending) {
    for (let d = 1; d <= 5; d++) {
      const j = [i - d, i + d].find((x) => x > 0 && x < bars.length && !used.has(x) && near(seenAt(x), ratio));
      if (j == null) continue;
      used.add(j);
      for (const a of g) add(j, { ratio: a.ratio, kind: a.kind, text: a.text });
      break;
    }
  }

  // rights, demergers and splits whose ratio was cut off in the announcement
  const seenText = new Set();
  for (const a of actions) {
    const i = barOn(a.ex);
    if (i < 0 || used.has(i)) continue;
    const key = `${a.kind}|${a.text}|${i}`;
    if (seenText.has(key)) continue;
    const prev = bars[i - 1].c;
    let ratio = null;
    if (a.kind === 'rights' && a.premium != null) {
      const price = a.premium + faceValue;
      if (price < prev) ratio = (a.b * prev + a.a * price) / ((a.a + a.b) * prev);
    } else if ((a.kind === 'demerger' || (a.kind === 'split' && a.ratio == null)) && seenAt(i) < 0.97) {
      ratio = seenAt(i);
    }
    if (ratio == null || !(ratio > 0)) continue;
    seenText.add(key);
    add(i, { ratio, kind: a.kind, text: a.text });
  }
  return plan;
}

/**
 * @param bars     one stock's sessions, oldest first; mutated in place. Each bar gains `rc` (raw close).
 * @param actions  that stock's official events from loadActions(), sorted by ex-date
 * @param faceValue used for the rights issue price (premium + face value)
 * @returns events applied: [{ date, ratio, kind, text }]
 */
export function adjust(bars, actions = [], faceValue = 0) {
  const plan = planActions(bars, actions, faceValue);
  const events = [];
  let f = 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    const raw = { o: b.o, c: b.c };
    b.rc = b.c;
    if (f !== 1) {
      b.o *= f; b.h *= f; b.l *= f; b.c *= f;
      b.v /= f;
    }
    if (i === 0) break;
    const prev = bars[i - 1].c; // still unadjusted here
    const official = plan.get(i);
    if (official) {
      for (const ev of official) {
        f *= ev.ratio;
        events.push({ date: b.date, ratio: Math.round(ev.ratio * 10000) / 10000, kind: ev.kind, text: ev.text });
      }
    } else if (raw.o / prev < CA_THRESHOLD) {
      const seen = raw.o / prev;
      const ratio = CA_RATIOS.find((r) => Math.abs(seen / r - 1) < 0.05) ?? seen;
      f *= ratio;
      events.push({ date: b.date, ratio: Math.round(ratio * 10000) / 10000, kind: 'inferred', text: null });
    }
  }
  return events;
}

const mean = (a, from, to) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / (to - from);
};
const smaAt = (a, n, end) => (end - n >= 0 ? mean(a, end - n, end) : null);

export function rsi(c, n = 14) {
  if (c.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const pct = (a, b) => (a == null || b == null || b === 0 ? null : (a / b - 1) * 100);

function metrics(bars) {
  const n = bars.length;
  const c = bars.map((b) => b.c);
  const v = bars.map((b) => b.v);
  const last = bars[n - 1];
  const close = last.c;
  const ret = (k) => (n > k ? pct(close, c[n - 1 - k]) : null);

  const win = bars.slice(Math.max(0, n - 252));
  const hi52 = Math.max(...win.map((b) => b.h));
  const lo52 = Math.min(...win.map((b) => b.l));
  const priorHi = win.length > 1 ? Math.max(...win.slice(0, -1).map((b) => b.h)) : null;
  const priorLo = win.length > 1 ? Math.min(...win.slice(0, -1).map((b) => b.l)) : null;

  const s20 = smaAt(c, 20, n), s50 = smaAt(c, 50, n), s200 = smaAt(c, 200, n);
  // 50/200 crossover within the last 10 sessions
  let cross = 0;
  if (s200 != null && n - 10 >= 200) {
    const then = smaAt(c, 50, n - 10) - smaAt(c, 200, n - 10);
    const now = s50 - s200;
    if (then <= 0 && now > 0) cross = 1;
    else if (then >= 0 && now < 0) cross = -1;
  }

  const avgVol20 = n > 20 ? mean(v, n - 21, n - 1) : null;
  const tv = bars.map((b) => b.turnover);
  const dl = bars.slice(Math.max(0, n - 20)).map((b) => b.deliv).filter((x) => x != null);

  return {
    series: last.series,
    close: r2(close),
    chg: r2(pct(last.c, last.prev)),
    w1: r1(ret(5)), m1: r1(ret(21)), m3: r1(ret(63)), m6: r1(ret(126)), y1: r1(ret(252)),
    hi52: r2(hi52), lo52: r2(lo52),
    fromHi: r1(pct(close, hi52)), fromLo: r1(pct(close, lo52)),
    newHi: priorHi != null && n >= 120 && last.h >= priorHi ? 1 : 0,
    newLo: priorLo != null && n >= 120 && last.l <= priorLo ? 1 : 0,
    vs20: r1(pct(close, s20)), vs50: r1(pct(close, s50)), vs200: r1(pct(close, s200)),
    cross,
    rsi: r1(rsi(c)),
    vol: Math.round(last.v),
    volX: avgVol20 ? r2(last.v / avgVol20) : null,
    turnover: r2(last.turnover),
    avgTurnover: r2(mean(tv, Math.max(0, n - 20), n)),
    deliv: r1(last.deliv),
    delivAvg: dl.length ? r1(dl.reduce((a, b) => a + b, 0) / dl.length) : null,
    sessions: n,
    spark: c.slice(-60).filter((_, i, a) => i % 2 === (a.length - 1) % 2).map(r2),
  };
}

export const fileSafe = (symbol) => symbol.replace(/[^A-Za-z0-9]/g, '_');

export async function sync({ log = console.log } = {}) {
  await mkdir(path.join(RAW, 'lists'), { recursive: true });
  log('Fetching NSE bhavcopies…');
  const files = await fetchDays(log);

  log('Fetching corporate actions, market cap and P/E…');
  await fetchExtras(log, LOOKBACK_CALENDAR_DAYS + 400); // dividend yield and earnings growth look a year back
  const fund = await loadFundamentals();

  log('Loading reference lists…');
  const master = await cachedList('EQUITY_L', 7, log);
  const names = new Map(master.map((r) => [r.SYMBOL, r['NAME OF COMPANY']]));
  const sectors = new Map((await cachedList(SECTOR_LIST, 7, log)).map((r) => [r.Symbol, r.Industry]));
  const membership = new Map();
  for (const [code, , list] of INDICES) {
    for (const r of await cachedList(list, 7, log)) membership.set(r.Symbol, code);
  }

  log('Computing metrics…');
  const { bySymbol, dates } = await loadHistory(files);
  if (!dates.length) throw new Error('No bhavcopy data could be loaded');
  const latest = dates[dates.length - 1];

  await rm(path.join(OUT, 'h'), { recursive: true, force: true });
  await mkdir(path.join(OUT, 'h'), { recursive: true });

  const rows = [];
  let adjusted = 0;
  for (const [symbol, days] of bySymbol) {
    if (!names.has(symbol)) continue; // ETFs, bonds etc. aren't in the company master
    const bars = [...days.values()].sort((a, b) => a.date - b.date);
    if (bars[bars.length - 1].date !== latest) continue; // not traded in the latest session
    const actions = fund.actions.get(symbol) ?? [];
    const ca = adjust(bars, actions, fund.faceValue.get(symbol) ?? 0);
    if (ca.length) adjusted++;
    const fs = fundamentalSeries(symbol, bars, ca, fund);
    const at = bars.length - 1;
    const pe = r2(fs.pe[at]);
    // dividends, splits, bonuses etc. from the last year, plus anything announced ahead
    const acts = [...new Map(actions.filter((a) => a.ex > latest - 10000).map((a) => [`${a.ex}|${a.text}`, { ex: a.ex, text: a.text }])).values()];
    rows.push({
      s: symbol,
      name: names.get(symbol),
      sector: sectors.get(symbol) ?? null,
      idx: membership.get(symbol) ?? null,
      ...metrics(bars),
      mcap: r2(fs.mcap[at]),
      pe,
      eps: pe ? r2(bars[at].rc / pe) : null,
      epsG: r1(fs.epsG[at]),
      divY: r2(fs.divY[at]),
      nextEx: acts.find((a) => a.ex > latest) ?? null,
      ca: ca.length,
    });
    await writeFile(
      path.join(OUT, 'h', `${fileSafe(symbol)}.json`),
      JSON.stringify({
        d: bars.map((b) => b.date),
        o: bars.map((b) => r2(b.o)),
        h: bars.map((b) => r2(b.h)),
        l: bars.map((b) => r2(b.l)),
        c: bars.map((b) => r2(b.c)),
        v: bars.map((b) => Math.round(b.v)),
        dl: bars.map((b) => b.deliv),
        ca,
        acts,
      }),
    );
  }
  // SEBI/AMFI convention: top 100 by market cap are large caps, the next 150 mid caps
  [...rows].sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0)).forEach((r, i) => {
    r.cap = r.mcap == null ? null : i < 100 ? 'L' : i < 250 ? 'M' : 'S';
  });
  rows.sort((a, b) => (b.avgTurnover ?? 0) - (a.avgTurnover ?? 0));

  const meta = {
    asOf: latest,
    generatedAt: new Date().toISOString(),
    sessions: dates.length,
    indices: INDICES.map(([code, label]) => ({ code, label })),
    rows,
  };
  await writeFile(path.join(OUT, 'screener.json'), JSON.stringify(meta));
  log(`Done: ${rows.length} stocks, ${dates.length} sessions, as of ${latest} (${adjusted} adjusted for corporate actions)`);
  return { asOf: latest, stocks: rows.length, sessions: dates.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sync().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
