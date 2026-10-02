// Official NSE corporate actions, market cap and P/E.
//
// Sources (all from the NSE archive, one set per trading session):
//   PRddmmyy.zip   -> bc*.csv   corporate actions with ex-dates (each file looks ~6 sessions ahead)
//                  -> mcap*.csv issued shares and market cap
//   PE_ddmmyy.csv  -> trailing P/E per symbol
//
// Everything else here (EPS, earnings growth, dividend yield) is derived from
// those three files plus prices.

import { mkdir, readFile, readdir, writeFile, stat, rm } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const DIRS = { ca: path.join(RAW, 'ca'), mcap: path.join(RAW, 'mcap'), pe: path.join(RAW, 'pe') };
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SERIES = new Set(['EQ', 'BE', 'BZ']);
const KEEP_LATEST_MCAP = 3; // besides the first session of every month

const exists = (p) => stat(p).then(() => true, () => false);
const tagDate = (tag) => Number(tag.slice(4)) * 10000 + Number(tag.slice(2, 4)) * 100 + Number(tag.slice(0, 2));

async function download(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// Minimal zip reader: returns { lowercased name -> Buffer } for stored/deflated entries.
function unzip(buf) {
  const out = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return out;
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0 && buf.readUInt32LE(p) === 0x02014b50; n--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).toLowerCase();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = inflateRawSync(data);
    p += 46 + nameLen + skip;
  }
  return out;
}

/**
 * Makes sure the corporate-action, market-cap and P/E files exist for every
 * trading session we hold a bhavcopy for. Sessions are discovered from
 * data/raw/DDMMYYYY.csv, so run this after fetchDays().
 */
export async function fetchExtras(log = () => {}, lookbackDays = Infinity) {
  for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true });
  const cutoff = lookbackDays === Infinity ? 0 : Date.now() - lookbackDays * 864e5;
  const tags = (await readdir(RAW))
    .filter((f) => /^\d{8}\.csv$/.test(f))
    .map((f) => f.slice(0, 8))
    .sort((a, b) => tagDate(a) - tagDate(b))
    .filter((t) => Date.UTC(+t.slice(4), +t.slice(2, 4) - 1, +t.slice(0, 2)) >= cutoff);

  const keepMcap = new Set(tags.slice(-KEEP_LATEST_MCAP));
  tags.forEach((t, i) => {
    if (i === 0 || tags[i - 1].slice(2) !== t.slice(2)) keepMcap.add(t); // first session of a month
  });
  const recent = new Set(tags.slice(-3)); // may simply not be published yet: retry next time

  const jobs = [];
  for (const tag of tags) {
    const short = tag.slice(0, 4) + tag.slice(6);
    const needCa = !(await exists(path.join(DIRS.ca, `${tag}.csv`)));
    const needMcap = keepMcap.has(tag) && !(await exists(path.join(DIRS.mcap, `${tag}.csv`)));
    if (needCa || needMcap) {
      jobs.push(async () => {
        const zip = await download(`https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR${short}.zip`);
        const files = zip ? unzip(zip) : {};
        const pick = (re) => Object.entries(files).find(([name]) => re.test(name))?.[1];
        const bc = pick(/^bc\d+\.csv$/);
        const mcap = pick(/^mcap\d+\.csv$/);
        // an empty file marks "looked, nothing there" so old sessions aren't re-requested
        if (needCa && (bc || !recent.has(tag))) await writeFile(path.join(DIRS.ca, `${tag}.csv`), bc ?? '');
        if (needMcap && (mcap || !recent.has(tag))) await writeFile(path.join(DIRS.mcap, `${tag}.csv`), mcap ?? '');
      });
    }
    if (!(await exists(path.join(DIRS.pe, `${tag}.csv`)))) {
      jobs.push(async () => {
        const pe = await download(`https://nsearchives.nseindia.com/content/equities/peDetail/PE_${short}.csv`);
        const ok = pe && pe.toString('utf8', 0, 6) === 'SYMBOL';
        if (ok || !recent.has(tag)) await writeFile(path.join(DIRS.pe, `${tag}.csv`), ok ? pe : '');
      });
    }
  }

  const total = jobs.length;
  let done = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let job; (job = jobs.shift()); ) {
        await job();
        if (++done % 100 === 0) log(`  fetched ${done}/${total} fundamentals files…`);
      }
    }),
  );

  // yesterday's "latest" market-cap snapshots are no longer needed
  for (const f of await readdir(DIRS.mcap)) {
    if (!keepMcap.has(f.slice(0, 8))) await rm(path.join(DIRS.mcap, f));
  }
  log(`  ${total} fundamentals file(s) requested`);
  return tags;
}

const num = (s) => Number(String(s).replace(/,/g, ''));
// the archive switched from DD/MM/YYYY to YYYY-MM-DD in 2025
const exDate = (s) => {
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return dmy ? Number(dmy[3] + dmy[2] + dmy[1]) : Number(s.replace(/-/g, '')) || 0;
};

/**
 * Parses an NSE corporate-action purpose string into structured events.
 * The field is free text cut off at ~25 characters, so a split whose target
 * face value was truncated comes back with `ratio: null`.
 */
export function parsePurpose(text) {
  const t = text.toUpperCase();
  const out = [];
  let rest = t;
  const take = (re) => {
    const m = re.exec(rest);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };
  const fv = take(/(?:SPLT|SPLIT|CONSOL\w*)[^/]*?(?:FRM|FROM)\s*R[SE]\.?\s*([\d.]+)\S*\s+TO(?:\s+(?:R[SE]\.?\s*)?([\d.]+))?/);
  if (fv) out.push({ kind: 'split', ratio: num(fv[2]) > 0 && num(fv[1]) > 0 ? num(fv[2]) / num(fv[1]) : null });
  const bonus = take(/BONUS\s+(\d+)\s*:\s*(\d+)/);
  if (bonus) out.push({ kind: 'bonus', ratio: num(bonus[2]) / (num(bonus[1]) + num(bonus[2])) });
  const rights = take(/RI?GHTS?\s+(\d+)\s*:\s*(\d+)(?:\s*@\s*(?:PRM|PREMIUM)\s*R[SE]\.?\s*([\d.,]+))?/);
  if (rights) out.push({ kind: 'rights', a: num(rights[1]), b: num(rights[2]), premium: rights[3] ? num(rights[3]) : null });
  if (/DEMERGER|SCHEME OF ARR|SPIN/.test(t)) out.push({ kind: 'demerger' });
  if (/DIV|SPDV|INTDV|\bDV\b/.test(rest)) {
    // "DIV - RS 5 PER SH", "DIV-RS 5/SPLDIV-RS 3", "DIV/SPDV - RS 2 & 3": add up every amount
    let amount = 0;
    for (const m of rest.matchAll(/\d+(?:\.\d+)?/g)) amount += Number(m[0]);
    if (amount > 0) out.push({ kind: 'dividend', amount });
  }
  return out;
}

/** symbol -> events sorted by ex-date: [{ ex, text, kind, ratio?, amount?, a?, b?, premium? }] */
export async function loadActions() {
  const seen = new Set();
  const bySymbol = new Map();
  for (const f of (await readdir(DIRS.ca).catch(() => [])).filter((x) => x.endsWith('.csv'))) {
    const lines = (await readFile(path.join(DIRS.ca, f), 'utf8')).split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length < 10 || !SERIES.has(c[0].trim())) continue;
      const symbol = c[1].trim();
      const ex = exDate(c[6].trim());
      const text = c.slice(9).join(',').trim();
      if (!ex || !text) continue;
      const key = `${symbol}|${ex}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = bySymbol.get(symbol) ?? bySymbol.set(symbol, []).get(symbol);
      for (const ev of parsePurpose(text)) list.push({ ex, text, ...ev });
    }
  }
  for (const list of bySymbol.values()) list.sort((a, b) => a.ex - b.ex);
  return bySymbol;
}

/** date -> Map(symbol -> P/E) for every session with a P/E file. */
export async function loadPE() {
  const byDate = new Map();
  for (const f of (await readdir(DIRS.pe).catch(() => [])).filter((x) => x.endsWith('.csv'))) {
    const lines = (await readFile(path.join(DIRS.pe, f), 'utf8')).split(/\r?\n/);
    if (lines.length < 2) continue;
    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const pe = Number(c[1]);
      if (c[0] && pe > 0) map.set(c[0].trim(), pe);
    }
    byDate.set(tagDate(f.slice(0, 8)), map);
  }
  return byDate;
}

/** Market-cap snapshots, oldest first: [{ date, bySymbol: Map(symbol -> { shares, mcap, fv }) }] (mcap in ₹ Cr). */
export async function loadMcap() {
  const snaps = [];
  for (const f of (await readdir(DIRS.mcap).catch(() => [])).filter((x) => x.endsWith('.csv'))) {
    const lines = (await readFile(path.join(DIRS.mcap, f), 'utf8')).split(/\r?\n/);
    if (lines.length < 2) continue;
    const bySymbol = new Map();
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length < 10 || !SERIES.has(c[2].trim())) continue;
      const shares = num(c[7]);
      const mcap = num(c[9]) / 1e7;
      if (shares > 0 && mcap > 0) bySymbol.set(c[1].trim(), { shares, mcap, fv: num(c[6]) });
    }
    snaps.push({ date: tagDate(f.slice(0, 8)), bySymbol });
  }
  return snaps.sort((a, b) => a.date - b.date);
}

/**
 * Per-session fundamentals for one stock. `bars` must already be adjusted
 * (each bar carries `rc`, its raw close) and `events` is what adjust() returned.
 *
 * - mcap: issued shares x raw close, ₹ Cr. Shares come from the nearest monthly
 *   snapshot, corrected for any split or bonus between the snapshot and the bar.
 * - pe: NSE's trailing P/E for that session.
 * - epsG: growth in trailing earnings (mcap / P/E) versus 252 sessions earlier, %.
 * - divY: dividends with an ex-date in the previous 12 months / price, %.
 */
export function fundamentalSeries(symbol, bars, events, ctx) {
  const n = bars.length;
  const out = {
    pe: new Float32Array(n).fill(NaN),
    mcap: new Float32Array(n).fill(NaN),
    epsG: new Float32Array(n).fill(NaN),
    divY: new Float32Array(n).fill(NaN),
  };
  // cumulative split/bonus factor up to and including a date
  const shareEvents = events.filter((e) => e.kind === 'split' || e.kind === 'bonus');
  const factor = (date) => shareEvents.reduce((f, e) => (e.date <= date ? f * e.ratio : f), 1);
  const snaps = ctx.snaps.filter((s) => s.bySymbol.has(symbol));
  const dividends = (ctx.actions.get(symbol) ?? []).filter((a) => a.kind === 'dividend');
  const earnings = new Float64Array(n).fill(NaN);

  let si = 0;
  for (let t = 0; t < n; t++) {
    const { date, rc } = bars[t];
    if (snaps.length) {
      while (si + 1 < snaps.length && snaps[si + 1].date <= date) si++;
      const snap = snaps[si];
      const shares = snap.bySymbol.get(symbol).shares * (factor(snap.date) / factor(date));
      out.mcap[t] = (shares * rc) / 1e7;
    }
    const pe = ctx.pe.get(date)?.get(symbol);
    if (pe > 0) {
      out.pe[t] = pe;
      earnings[t] = out.mcap[t] / pe;
      if (t >= 252 && earnings[t - 252] > 0) out.epsG[t] = (earnings[t] / earnings[t - 252] - 1) * 100;
    }
    if (ctx.caFrom && date - 10000 >= ctx.caFrom) {
      let paid = 0;
      for (const d of dividends) {
        if (d.ex > date - 10000 && d.ex <= date) paid += d.amount * (factor(date) / factor(d.ex - 1));
      }
      out.divY[t] = (paid / rc) * 100;
    }
  }
  return out;
}

/** Loads everything fundamentalSeries() and adjust() need. */
export async function loadFundamentals() {
  const [actions, pe, snaps] = await Promise.all([loadActions(), loadPE(), loadMcap()]);
  const caDates = (await readdir(DIRS.ca).catch(() => []))
    .filter((f) => /^\d{8}\.csv$/.test(f))
    .map((f) => tagDate(f.slice(0, 8)));
  // dividend yield needs a full year of corporate-action history behind it
  const caFrom = caDates.length ? Math.min(...caDates) : null;
  const faceValue = new Map();
  for (const s of snaps) for (const [sym, v] of s.bySymbol) faceValue.set(sym, v.fv);
  return { actions, pe, snaps, caFrom, faceValue };
}
