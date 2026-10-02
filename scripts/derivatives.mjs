// NSE end-of-day derivatives data: futures and options open interest per
// stock, index option positioning, who holds what (FII / client / pro), index
// levels and India VIX.
//
// Sources (NSE archive, one set per session):
//   F&O bhavcopy   every contract's settle price, open interest and volume
//   fao_participant_oi   open interest by participant type
//   ind_close_all        index closes, India VIX, index P/E
//   fo_secban            stocks in the F&O ban period (current only)
//
// A raw F&O bhavcopy is ~6 MB, so each session is reduced to a small summary
// (data/raw/fo/DDMMYYYY.json) and the download is discarded.

import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, unzip } from './fundamentals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const DIRS = { fo: path.join(RAW, 'fo'), poi: path.join(RAW, 'poi'), idx: path.join(RAW, 'idx') };
const UDIFF_FROM = 20240708; // NSE switched bhavcopy formats on this date
const INDEX_FUTURES = new Set(['NIFTY', 'BANKNIFTY']);
const KEEP_INDICES = ['Nifty 50', 'Nifty Bank', 'India VIX', 'Nifty Midcap 150', 'Nifty Smallcap 250', 'Nifty 500'];
const RATE = 0.065; // risk-free rate for implied volatility
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const exists = (p) => stat(p).then(() => true, () => false);
const tagDate = (tag) => Number(tag.slice(4)) * 10000 + Number(tag.slice(2, 4)) * 100 + Number(tag.slice(0, 2));
const dayNumber = (d) => Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100) / 864e5;
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// ---------- Black-Scholes implied volatility ----------
const cdf = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
function price(call, S, K, T, v) {
  const d1 = (Math.log(S / K) + (RATE + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);
  return call ? S * cdf(d1) - K * Math.exp(-RATE * T) * cdf(d2) : K * Math.exp(-RATE * T) * cdf(-d2) - S * cdf(-d1);
}
function impliedVol(call, S, K, T, premium) {
  if (!(premium > 0 && S > 0 && K > 0 && T > 0)) return null;
  let lo = 0.01, hi = 4;
  if (price(call, S, K, T, lo) > premium || price(call, S, K, T, hi) < premium) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (price(call, S, K, T, mid) > premium) hi = mid; else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}

// ---------- Reducing one session's bhavcopy ----------
function parseRows(text, date) {
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(',');
  const udiff = head[0] === 'TradDt';
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 14) continue;
    if (udiff) {
      rows.push({
        fut: c[4] === 'STF' || c[4] === 'IDF',
        index: c[4] === 'IDF' || c[4] === 'IDO',
        symbol: c[7],
        expiry: Number(c[9].replace(/-/g, '')),
        strike: +c[11],
        call: c[12] === 'CE',
        settle: +c[21] || +c[17],
        spot: +c[20],
        oi: +c[22],
        chg: +c[23],
        vol: +c[24],
      });
    } else {
      const [d, m, y] = c[2].split('-');
      rows.push({
        fut: c[0].startsWith('FUT'),
        index: c[0].endsWith('IDX'),
        symbol: c[1],
        expiry: Number(y) * 10000 + (MONTHS.indexOf(m.toUpperCase()) + 1) * 100 + Number(d),
        strike: +c[3],
        call: c[4] === 'CE',
        settle: +c[9] || +c[8],
        spot: NaN,
        oi: +c[12],
        chg: +c[13],
        vol: +c[10],
      });
    }
  }
  return rows.filter((r) => r.symbol && r.expiry >= date);
}

function summarise(text, date) {
  const by = new Map();
  for (const r of parseRows(text, date)) {
    if (r.index && !INDEX_FUTURES.has(r.symbol)) continue;
    let u = by.get(r.symbol);
    if (!u) by.set(r.symbol, (u = { index: r.index, oi: 0, chg: 0, vol: 0, coi: 0, poi: 0, spot: r.spot, futs: [], opts: [] }));
    if (r.fut) {
      u.oi += r.oi; u.chg += r.chg; u.vol += r.vol;
      u.futs.push(r);
    } else {
      if (r.call) u.coi += r.oi; else u.poi += r.oi;
      u.opts.push(r);
    }
    if (Number.isFinite(r.spot) && r.spot > 0) u.spot = r.spot;
  }

  const out = { date, stocks: {}, index: {} };
  for (const [symbol, u] of by) {
    u.futs.sort((a, b) => a.expiry - b.expiry);
    const near = u.futs[0];
    const spot = u.spot > 0 ? u.spot : near?.settle;
    // ATM implied volatility from the nearest expiry with at least 3 days left
    let iv = null;
    const expiries = [...new Set(u.opts.map((o) => o.expiry))].sort((a, b) => a - b);
    const expiry = expiries.find((e) => dayNumber(e) - dayNumber(date) >= 3) ?? expiries[0];
    const chain = u.opts.filter((o) => o.expiry === expiry);
    if (spot > 0 && chain.length) {
      const T = Math.max(1, dayNumber(expiry) - dayNumber(date)) / 365;
      const atm = chain.reduce((best, o) => (Math.abs(o.strike - spot) < Math.abs(best - spot) ? o.strike : best), chain[0].strike);
      const vols = chain
        .filter((o) => o.strike === atm)
        .map((o) => impliedVol(o.call, spot, o.strike, T, o.settle))
        .filter((v) => v != null);
      if (vols.length) iv = vols.reduce((a, b) => a + b, 0) / vols.length;
    }
    const base = { oi: u.oi, chg: u.chg, vol: u.vol, coi: u.coi, poi: u.poi, iv: r2(iv) };
    if (!u.index) {
      out.stocks[symbol] = base;
      continue;
    }
    // index: keep the nearest expiry's strike-wise open interest for max pain and OI walls
    const nearExp = expiries[0];
    const strikes = new Map();
    for (const o of u.opts) {
      if (o.expiry !== nearExp) continue;
      const s = strikes.get(o.strike) ?? strikes.set(o.strike, [o.strike, 0, 0]).get(o.strike);
      s[o.call ? 1 : 2] += o.oi;
    }
    out.index[symbol] = { ...base, spot: r2(spot), fut: r2(near?.settle), expiry: nearExp ?? null, strikes: [...strikes.values()].sort((a, b) => a[0] - b[0]) };
  }
  return out;
}

// ---------- Download ----------
/** Fetches whatever is missing for every session we hold a bhavcopy for. Run after fetchDays(). */
export async function fetchDerivatives(log = () => {}, lookbackDays = Infinity) {
  for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true });
  const cutoff = lookbackDays === Infinity ? 0 : Date.now() - lookbackDays * 864e5;
  const tags = (await readdir(RAW))
    .filter((f) => /^\d{8}\.csv$/.test(f))
    .map((f) => f.slice(0, 8))
    .sort((a, b) => tagDate(a) - tagDate(b))
    .filter((t) => Date.UTC(+t.slice(4), +t.slice(2, 4) - 1, +t.slice(0, 2)) >= cutoff);
  const recent = new Set(tags.slice(-3)); // may not be published yet: retried next time

  const jobs = [];
  for (const tag of tags) {
    const date = tagDate(tag);
    const ymd = String(date);
    if (!(await exists(path.join(DIRS.fo, `${tag}.json`)))) {
      jobs.push(async () => {
        const urls = [];
        if (date >= UDIFF_FROM) urls.push(`https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ymd}_F_0000.csv.zip`);
        if (date < UDIFF_FROM + 100) {
          const mon = MONTHS[Number(ymd.slice(4, 6)) - 1];
          urls.push(`https://nsearchives.nseindia.com/content/historical/DERIVATIVES/${ymd.slice(0, 4)}/${mon}/fo${ymd.slice(6)}${mon}${ymd.slice(0, 4)}bhav.csv.zip`);
        }
        let summary = null;
        for (const url of urls) {
          const zip = await download(url);
          const csv = zip && Object.values(unzip(zip))[0];
          if (csv) { summary = summarise(csv.toString('utf8'), date); break; }
        }
        if (summary || !recent.has(tag)) await writeFile(path.join(DIRS.fo, `${tag}.json`), JSON.stringify(summary ?? {}));
      });
    }
    if (!(await exists(path.join(DIRS.poi, `${tag}.csv`)))) {
      jobs.push(async () => {
        const buf = await download(`https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${tag}.csv`);
        const ok = buf && buf.toString('utf8', 0, 400).includes('Client Type');
        if (ok || !recent.has(tag)) await writeFile(path.join(DIRS.poi, `${tag}.csv`), ok ? buf : '');
      });
    }
    if (!(await exists(path.join(DIRS.idx, `${tag}.csv`)))) {
      jobs.push(async () => {
        const buf = await download(`https://nsearchives.nseindia.com/content/indices/ind_close_all_${tag}.csv`);
        const text = buf ? buf.toString('utf8') : '';
        const ok = text.startsWith('Index Name');
        const keep = ok ? text.split(/\r?\n/).filter((l, i) => i === 0 || KEEP_INDICES.some((n) => l.startsWith(`${n},`))) : [];
        if (ok || !recent.has(tag)) await writeFile(path.join(DIRS.idx, `${tag}.csv`), [...new Set(keep)].join('\n'));
      });
    }
  }
  jobs.push(async () => {
    const buf = await download('https://nsearchives.nseindia.com/content/fo/fo_secban.csv').catch(() => null);
    if (buf) await writeFile(path.join(RAW, 'fo_secban.csv'), buf);
  });

  const total = jobs.length - 1;
  let done = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let job; (job = jobs.shift()); ) {
        await job();
        if (++done % 100 === 0) log(`  fetched ${done}/${total} derivatives files…`);
      }
    }),
  );
  log(`  ${total} derivatives file(s) requested`);
}

// ---------- Loading ----------
const PARTICIPANTS = ['Client', 'DII', 'FII', 'Pro'];

export async function loadDerivatives() {
  const days = new Map();
  for (const f of (await readdir(DIRS.fo).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    const day = JSON.parse(await readFile(path.join(DIRS.fo, f), 'utf8'));
    if (day.date) days.set(day.date, day);
  }
  const poi = new Map();
  for (const f of (await readdir(DIRS.poi).catch(() => [])).filter((x) => x.endsWith('.csv'))) {
    const rows = {};
    for (const line of (await readFile(path.join(DIRS.poi, f), 'utf8')).split(/\r?\n/)) {
      const c = line.split(',').map((x) => x.trim());
      if (PARTICIPANTS.includes(c[0])) rows[c[0]] = { idxFutLong: +c[1], idxFutShort: +c[2], stkFutLong: +c[3], stkFutShort: +c[4] };
    }
    if (rows.FII) poi.set(tagDate(f.slice(0, 8)), rows);
  }
  const idx = new Map();
  for (const f of (await readdir(DIRS.idx).catch(() => [])).filter((x) => x.endsWith('.csv'))) {
    const rows = {};
    for (const line of (await readFile(path.join(DIRS.idx, f), 'utf8')).split(/\r?\n/).slice(1)) {
      const c = line.split(',');
      if (c.length > 7) rows[c[0]] = { close: +c[5], chg: +c[7], pe: +c[10] || null };
    }
    if (Object.keys(rows).length) idx.set(tagDate(f.slice(0, 8)), rows);
  }
  const ban = (await readFile(path.join(RAW, 'fo_secban.csv'), 'utf8').catch(() => ''))
    .split(/\r?\n/)
    .map((l) => l.split(',')[1]?.trim())
    .filter(Boolean);
  const dates = [...days.keys()].sort((a, b) => a - b);
  return { days, poi, idx, ban, dates, latest: dates[dates.length - 1] ?? null };
}

const NEW_LISTING_SESSIONS = 20;
export const BUILD_MIN = 3; // % change in futures open interest that counts as a build-up or unwinding

/**
 * Per-session derivatives metrics for one stock, aligned to its price bars.
 * Open interest is summed across all futures expiries, so a rollover doesn't
 * register as a change. Everything is NaN for stocks without F&O contracts.
 *
 *   foOiChg  futures OI change on the day, %
 *   oi5      futures OI change over five sessions, %
 *   pcr      put OI / call OI across the stock's options
 *   iv       at-the-money implied volatility, %
 *   ivRank   share of the past year's sessions with a lower IV, %
 * and the four price/OI combinations as 0/1 flags:
 *   longBuild  price up, OI up      shortBuild  price down, OI up
 *   shortCover price up, OI down    longUnwind  price down, OI down
 */
export function derivativeSeries(symbol, bars, deriv) {
  const n = bars.length;
  const nan = () => new Float32Array(n).fill(NaN);
  const m = { foOiChg: nan(), oi5: nan(), pcr: nan(), iv: nan(), ivRank: nan() };
  const f = { longBuild: new Uint8Array(n), shortBuild: new Uint8Array(n), shortCover: new Uint8Array(n), longUnwind: new Uint8Array(n) };
  const oi = new Float64Array(n).fill(NaN);
  let any = false;
  let seen = 0;
  const ivs = [];
  for (let t = 0; t < n; t++) {
    const d = deriv.days.get(bars[t].date)?.stocks[symbol];
    if (!d) continue;
    any = true;
    seen++;
    oi[t] = d.oi;
    if (d.oi - d.chg > 0) m.foOiChg[t] = (d.chg / (d.oi - d.chg)) * 100;
    if (t >= 5 && oi[t - 5] > 0) m.oi5[t] = (d.oi / oi[t - 5] - 1) * 100;
    if (d.coi > 0) m.pcr[t] = d.poi / d.coi;
    if (d.iv != null) {
      m.iv[t] = d.iv;
      const window = ivs.filter((x) => x[0] >= t - 252);
      if (window.length >= 60) m.ivRank[t] = (window.filter((x) => x[1] < d.iv).length / window.length) * 100;
      ivs.push([t, d.iv]);
    }
    const move = t > 0 ? bars[t].c / bars[t - 1].c - 1 : 0;
    // a stock newly admitted to F&O builds open interest from zero for weeks; that isn't a signal
    if (seen < NEW_LISTING_SESSIONS) continue;
    const o = m.foOiChg[t];
    if (o >= BUILD_MIN) f[move > 0 ? 'longBuild' : 'shortBuild'][t] = move === 0 ? 0 : 1;
    else if (o <= -BUILD_MIN) f[move > 0 ? 'shortCover' : 'longUnwind'][t] = move === 0 ? 0 : 1;
  }
  return { any, m, f };
}

/** Index option positioning for the Brief: PCR, max pain, biggest OI strikes, VIX, FII futures. */
export function indexPositioning(deriv, date) {
  const day = deriv.days.get(date);
  if (!day) return null;
  const at = deriv.dates.indexOf(date);
  const prevDate = at > 0 ? deriv.dates[at - 1] : null;
  const levels = deriv.idx.get(date) ?? {};
  const SPOT = { NIFTY: 'Nifty 50', BANKNIFTY: 'Nifty Bank' };

  const indices = Object.entries(day.index).map(([symbol, x]) => {
    // max pain: the expiry price at which option holders, in total, are paid the least
    let best = null;
    for (const [k] of x.strikes) {
      let pay = 0;
      for (const [s, c, p] of x.strikes) pay += Math.max(0, k - s) * c + Math.max(0, s - k) * p;
      if (!best || pay < best[1]) best = [k, pay];
    }
    const top = (i) => [...x.strikes].sort((a, b) => b[i] - a[i]).slice(0, 3).map((s) => ({ strike: s[0], oi: s[i] }));
    const nearCall = x.strikes.reduce((s, r) => s + r[1], 0);
    const nearPut = x.strikes.reduce((s, r) => s + r[2], 0);
    const level = levels[SPOT[symbol]];
    const spot = level?.close ?? x.spot;
    // the heaviest call OI above the price and put OI below it: where option writers are most committed
    const wall = (i, side) => x.strikes.filter((s) => (side > 0 ? s[0] >= spot : s[0] <= spot)).sort((a, b) => b[i] - a[i])[0]?.[0] ?? null;
    return {
      symbol,
      name: SPOT[symbol],
      close: level?.close ?? x.spot,
      chg: level?.chg ?? null,
      pe: level?.pe ?? null,
      futOiChg: x.oi - x.chg > 0 ? r2((x.chg / (x.oi - x.chg)) * 100) : null,
      pcr: x.coi > 0 ? r2(x.poi / x.coi) : null,
      pcrNear: nearCall > 0 ? r2(nearPut / nearCall) : null,
      expiry: x.expiry,
      maxPain: best?.[0] ?? null,
      resistance: wall(1, 1),
      support: wall(2, -1),
      callWalls: top(1),
      putWalls: top(2),
      iv: x.iv,
    };
  });

  const vix = levels['India VIX'];
  const who = (d) => {
    const p = deriv.poi.get(d);
    if (!p) return null;
    return Object.fromEntries(
      ['FII', 'Client', 'Pro', 'DII'].map((k) => [k, { net: p[k].idxFutLong - p[k].idxFutShort, longShare: r2((p[k].idxFutLong / (p[k].idxFutLong + p[k].idxFutShort || 1)) * 100) }]),
    );
  };
  const now = who(date);
  const before = prevDate ? who(prevDate) : null;
  return {
    indices,
    vix: vix ? { close: vix.close, chg: vix.chg } : null,
    participants: now && ['FII', 'Client', 'Pro', 'DII'].map((k) => ({ who: k, net: now[k].net, longShare: now[k].longShare, netChg: before ? now[k].net - before[k].net : null })),
    ban: deriv.ban,
  };
}
