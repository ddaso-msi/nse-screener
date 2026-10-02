// Exchange-traded funds: what each one tracks, its NAV and its running cost.
//
// Sources:
//   NSE  eq_etfseclist.csv     the ETFs listed on NSE and what each tracks
//   AMFI NAVAll.txt            every fund's latest NAV, keyed by ISIN
//   AMFI NAV history report    NAVs for one past date (used to backfill)
//   AMFI total expense ratios  the yearly cost each fund charges, by scheme name
//
// Prices, volume and history come from the same NSE bhavcopies as stocks.

import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const DIRS = { nav: path.join(RAW, 'nav'), ter: path.join(RAW, 'ter'), lists: path.join(RAW, 'lists') };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const NAV_SESSIONS = 60; // how far back premium/discount is averaged
const TER_CATEGORIES = [51, 52, 104, 105, 106, 107, 108, 109, 110]; // every AMFI category that holds ETFs (two naming schemes)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const exists = (p) => stat(p).then(() => true, () => false);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const amfiDate = (d) => `${String(d % 100).padStart(2, '0')}-${MONTHS[(Math.floor(d / 100) % 100) - 1]}-${Math.floor(d / 10000)}`;
const fromAmfiDate = (s) => {
  const [d, m, y] = s.trim().split('-');
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === (m ?? '').toLowerCase());
  return mi < 0 ? 0 : Number(y) * 10000 + (mi + 1) * 100 + Number(d);
};

async function getText(url, timeout = 45000) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 2) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

function csvRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const split = (line) => {
    const out = [];
    let cur = '', quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

const BROAD = /^(nifty 50|nifty next 50|bse sensex|bse sensex next 50|nifty 100|nifty 200|nifty 500|bse 500|nifty midcap 150|nifty midcap 100|nifty midcap 50|nifty smallcap 250|nifty smallcap 100|nifty largemidcap 250|nifty total market|msci india|bse midcap select|bse 100|nifty microcap 250)$/;
const FACTOR = /momentum|quality|value|low vol|alpha|equal weight|dividend|esg|shariah/;

/** A plain-language grouping for the ETF list. */
function categoryOf(type, key) {
  const k = key.toLowerCase();
  if (type === 'COMMODITY') return /silver/.test(k) ? 'Silver' : 'Gold';
  if (type === 'DEBT') return /liquid|overnight|1d rate/.test(k) ? 'Liquid' : 'Bonds and gilts';
  if (type === 'GLOBAL INDICES') return 'International';
  if (type !== 'EQUITY') return 'Other';
  if (FACTOR.test(k)) return 'Smart beta';
  if (BROAD.test(k.trim())) return 'Broad market';
  return 'Sector and theme';
}

/** symbol -> { isin, type, underlying, category } for every ETF listed on NSE. */
export async function loadEtfList(log = () => {}) {
  await mkdir(DIRS.lists, { recursive: true });
  const file = path.join(DIRS.lists, 'eq_etfseclist.csv');
  const fresh = (await exists(file)) && Date.now() - (await stat(file)).mtimeMs < 7 * 864e5;
  if (!fresh) {
    try {
      const text = await getText('https://archives.nseindia.com/content/equities/eq_etfseclist.csv');
      if (text.startsWith('Symbol')) await writeFile(file, text);
    } catch (err) {
      log(`  ETF list not refreshed (${err.message})`);
    }
  }
  const out = new Map();
  if (!(await exists(file))) return out;
  for (const r of csvRows(await readFile(file, 'utf8'))) {
    const type = (r['ETF Underlying'] ?? '').trim();
    const raw = (r['Underlying Key'] ?? '').trim();
    // the key is the index for equity funds; for the rest the asset column is more specific
    const generic = /^(gold|silver|global indices|gsecs\/gilt|bond|overnight etfs and liquid etf)$/i.test(raw);
    let underlying = (generic ? r['Underlying Asset'] || raw : raw).replace(/\s+/g, ' ').trim();
    if (type === 'COMMODITY') underlying = /silver/i.test(raw) ? 'Silver' : 'Gold';
    else if (/overnight|liquid/i.test(raw)) underlying = 'Overnight and liquid rate';
    out.set(r.Symbol.trim(), {
      isin: (r.ISINNumber ?? '').trim(),
      type,
      underlying: underlying.replace(/^NIFTY /, 'Nifty ').replace(/^nifty/i, 'Nifty'),
      category: categoryOf(type, raw),
      shortName: (r.SecurityName ?? '').trim(),
    });
  }
  return out;
}

function parseNav(text, isins) {
  // both AMFI layouts carry the ISIN, the NAV and the date; find them by shape
  const byDate = new Map();
  const names = {};
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(';');
    if (c.length < 6) continue;
    const isin = c.find((x) => /^INF[A-Z0-9]{9}$/.test(x.trim()))?.trim();
    if (!isin || !isins.has(isin)) continue;
    const date = fromAmfiDate(c[c.length - 1]);
    const nav = Number(c.findLast((x, i) => i < c.length - 1 && /^\d+(\.\d+)?$/.test(x.trim())));
    if (!date || !(nav > 0)) continue;
    (byDate.get(date) ?? byDate.set(date, {}).get(date))[isin] = nav;
    names[isin] = c.find((x) => /[a-z]{3}/i.test(x) && !/^INF/.test(x.trim()) && x.trim().length > 8)?.trim() ?? names[isin];
  }
  return { byDate, names };
}

/** Downloads the latest NAVs, backfills recent sessions, and refreshes this month's expense ratios. */
export async function fetchEtfData({ list, dates, log = () => {} }) {
  for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true });
  const isins = new Set([...list.values()].map((e) => e.isin).filter(Boolean));
  const save = async (date, navs) => {
    const file = path.join(DIRS.nav, `${date}.json`);
    const prev = (await exists(file)) ? JSON.parse(await readFile(file, 'utf8')) : {};
    await writeFile(file, JSON.stringify({ ...prev, ...navs }));
  };

  try {
    const { byDate, names } = parseNav(await getText('https://www.amfiindia.com/spages/NAVAll.txt'), isins);
    for (const [date, navs] of byDate) await save(date, navs);
    if (Object.keys(names).length) await writeFile(path.join(DIRS.nav, 'names.json'), JSON.stringify(names));
  } catch (err) {
    log(`  latest NAVs not refreshed (${err.message})`);
  }

  const recent = dates.slice(-NAV_SESSIONS);
  let backfilled = 0;
  for (const d of recent) {
    if (await exists(path.join(DIRS.nav, `${d}.json`))) continue;
    try {
      const { byDate } = parseNav(await getText(`https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=${amfiDate(d)}&todt=${amfiDate(d)}`, 90000), isins);
      // an empty file marks "asked, nothing published" unless the day is too recent to tell
      if (byDate.has(d) || d !== recent[recent.length - 1]) await save(d, byDate.get(d) ?? {});
      backfilled++;
    } catch (err) {
      log(`  NAV history for ${d} skipped (${err.message})`);
    }
  }

  // Expense ratios change rarely. A finished month is fetched once; the current
  // month fills in as funds report, so it is refreshed weekly and the previous
  // month is kept as the fallback.
  const latest = dates[dates.length - 1];
  const y = Math.floor(latest / 10000), m = Math.floor(latest / 100) % 100;
  const monthTags = [[y, m], m === 1 ? [y - 1, 12] : [y, m - 1]].map(([yy, mm]) => `${String(mm).padStart(2, '0')}-${yy}`);
  let ters = 0;
  for (const [i, month] of monthTags.entries()) {
    const terFile = path.join(DIRS.ter, `${month}.json`);
    const have = await exists(terFile);
    if (have && (i > 0 || Date.now() - (await stat(terFile)).mtimeMs < 7 * 864e5)) continue;
    try {
      const best = new Map(); // scheme name -> [date, ter]
      for (const cat of TER_CATEGORIES) {
        const page = async (n) =>
          JSON.parse(await getText(`https://www.amfiindia.com/api/populate-te-rdata-revised?MF_ID=All&Month=${month}&strCat=${cat}&strType=-1&page=${n}&pageSize=100`));
        const first = await page(1);
        const pages = [first];
        const rest = Array.from({ length: Math.max(0, first.meta.pageCount - 1) }, (_, k) => k + 2);
        await Promise.all(Array.from({ length: 4 }, async () => {
          for (let n; (n = rest.shift()); ) pages.push(await page(n));
        }));
        for (const p of pages) {
          for (const r of p.data) {
            const ter = Number(r.D_TER) > 0 ? Number(r.D_TER) : Number(r.R_TER);
            const key = norm(r.Scheme_Name);
            if (ter > 0 && (!best.has(key) || r.TER_Date > best.get(key)[0])) best.set(key, [r.TER_Date, ter]);
          }
        }
      }
      await writeFile(terFile, JSON.stringify(Object.fromEntries([...best].map(([k, v]) => [k, v[1]]))));
      ters += best.size;
    } catch (err) {
      log(`  expense ratios for ${month} not refreshed (${err.message})`);
    }
  }
  log(`  ETF data: ${backfilled} NAV day(s) backfilled${ters ? `, ${ters} expense ratios` : ''}`);
}

/** Everything known about each ETF beyond its price: { navByDate, names, ter(symbolInfo) }. */
export async function loadEtfData() {
  const navByDate = new Map();
  for (const f of (await readdir(DIRS.nav).catch(() => [])).filter((x) => /^\d{8}\.json$/.test(x))) {
    navByDate.set(Number(f.slice(0, 8)), JSON.parse(await readFile(path.join(DIRS.nav, f), 'utf8')));
  }
  const names = await readFile(path.join(DIRS.nav, 'names.json'), 'utf8').then(JSON.parse, () => ({}));
  // every month on file, oldest first, so the newest figure for each fund wins
  const ters = {};
  const files = (await readdir(DIRS.ter).catch(() => [])).filter((x) => x.endsWith('.json')).sort((a, b) => (a.slice(3, 7) + a.slice(0, 2)).localeCompare(b.slice(3, 7) + b.slice(0, 2)));
  for (const f of files) Object.assign(ters, JSON.parse(await readFile(path.join(DIRS.ter, f), 'utf8')));
  const navDates = [...navByDate.keys()].sort((a, b) => a - b);
  return {
    names,
    /** NAV on a date, or the most recent one before it: { nav, date } */
    navAt(isin, date) {
      for (let i = navDates.length - 1; i >= 0; i--) {
        if (navDates[i] > date) continue;
        const nav = navByDate.get(navDates[i])[isin];
        if (nav) return { nav, date: navDates[i] };
        if (date - navDates[i] > 10) break;
      }
      return null;
    },
    navOn: (isin, date) => navByDate.get(date)?.[isin] ?? null,
    ter(isin) {
      const name = names[isin];
      return name ? ters[norm(name)] ?? null : null;
    },
  };
}
