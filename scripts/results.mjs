// Quarterly results from the structured (XBRL) filings companies make to NSE.
//
// Two listings say which filings exist (both on www.nseindia.com/api):
//   integrated-filing-results      quarters ending March 2025 and later
//   corporates-financial-results   earlier quarters
// The filings themselves are XML files in the NSE archive. Each has the profit
// and loss account for the quarter; the half-year and year-end ones also carry
// the balance sheet.
//
// Only the figures the app uses are kept (data/raw/results/parsed.json), in
// ₹ crore, so a filing is downloaded once. Banks report in a different layout
// and are mapped onto the same fields where a like-for-like figure exists.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/raw/results');
const INDEX = path.join(DIR, 'index.json');
const PARSED = path.join(DIR, 'parsed.json');
const API = 'https://www.nseindia.com/api';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FROM_QUARTER = 20240331; // enough for year-on-year growth across the three years of prices
const PAGE = 2000;
const PARALLEL = 2; // the archive blocks an address that asks for much more than this
const PAUSE_MS = 600;
// filing-date windows of the older listing that hold the quarters from FROM_QUARTER to December 2024
const OLD_WINDOWS = [
  ['01-04-2024', '30-06-2024'], ['01-07-2024', '30-09-2024'], ['01-10-2024', '31-12-2024'],
  ['01-01-2025', '31-03-2025'], ['01-04-2025', '30-09-2025'],
];
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

const readJson = (file, fallback) => readFile(file, 'utf8').then(JSON.parse, () => fallback);
// "09-Jul-2026 18:36:12" -> { date: 20260709, late: true } (late = after the market closed)
function stamp(text) {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})(?: (\d{2}):(\d{2}))?/.exec(text ?? '');
  if (!m || !MONTHS[m[2].toUpperCase()]) return null;
  return {
    date: Number(m[3]) * 10000 + MONTHS[m[2].toUpperCase()] * 100 + Number(m[1]),
    late: m[4] != null && Number(m[4]) * 60 + Number(m[5]) >= 15 * 60 + 30,
  };
}

export async function nseApi(query) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}/${query}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-financial-results' },
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 2) throw new Error(`NSE results listing: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/** Brings the list of filings up to date. Entries: url -> { s, q, c, at, late, n }. */
async function refreshIndex(log) {
  const index = await readJson(INDEX, { filings: {}, old: [] });
  const add = (url, entry) => {
    if (!url?.endsWith('.xml') || !entry.s || !entry.q || !entry.at || entry.q < FROM_QUARTER) return false;
    if (index.filings[url]) return false;
    index.filings[url] = entry;
    return true;
  };

  for (const [from, to] of OLD_WINDOWS) {
    const key = `${from}:${to}`;
    if (index.old.includes(key)) continue;
    const list = await nseApi(`corporates-financial-results?index=equities&period=Quarterly&from_date=${from}&to_date=${to}`);
    for (const r of list) {
      const when = stamp(r.broadCastDate) ?? stamp(r.filingDate);
      add(r.xbrl, { s: r.symbol, q: stamp(r.toDate)?.date, c: r.consolidated === 'Consolidated' ? 1 : 0, at: when?.date, late: when?.late ? 1 : 0, n: Number(r.seqNumber) || 0 });
    }
    index.old.push(key);
    log(`  results listing ${from} to ${to}: ${list.length} filings`);
  }

  // newest first, so stop at the first page with nothing new
  let fresh = 0;
  for (let page = 1; ; page++) {
    const res = await nseApi(`integrated-filing-results?index=equities&period_ended=all&type=Integrated%20Filing-%20Financials&page=${page}&size=${PAGE}`);
    const list = res.data ?? [];
    let added = 0;
    for (const r of list) {
      const when = stamp(r.broadcast_Date) ?? stamp(r.creation_Date);
      if (add(r.xbrl, { s: r.symbol, q: stamp(r.qe_Date)?.date, c: r.consolidated === 'Consolidated' ? 1 : 0, at: when?.date, late: when?.late ? 1 : 0, n: Number(r.seq_Id) || 0 })) added++;
    }
    fresh += added;
    if (!added || list.length < PAGE) break;
  }
  if (fresh) log(`  ${fresh} new results filings listed`);
  await writeFile(INDEX, JSON.stringify(index));
  return index;
}

/** The filings to use: one per stock and quarter, on the basis (consolidated or not) of its latest quarter. */
function choose(index, symbols) {
  const bySymbol = new Map();
  for (const [url, f] of Object.entries(index.filings)) {
    if (symbols && !symbols.has(f.s)) continue;
    (bySymbol.get(f.s) ?? bySymbol.set(f.s, []).get(f.s)).push({ url, ...f });
  }
  const out = new Map();
  for (const [s, list] of bySymbol) {
    const lastQ = Math.max(...list.map((f) => f.q));
    const cons = list.some((f) => f.q === lastQ && f.c) ? 1 : 0;
    const byQuarter = new Map();
    for (const f of list) {
      if (f.c !== cons) continue;
      const have = byQuarter.get(f.q);
      // a revised filing replaces the original
      if (!have || f.at > have.at || (f.at === have.at && f.n > have.n)) byQuarter.set(f.q, f);
    }
    out.set(s, { cons, filings: [...byQuarter.values()].sort((a, b) => a.q - b.q) });
  }
  return out;
}

const CR = 1e7;
/** Pulls the figures the app uses out of one filing. Returns null if it has no income statement. */
export function parseFiling(xml, url = '') {
  const facts = { OneD: {}, OneI: {} };
  for (const m of xml.matchAll(/<[\w-]+:(\w+)\s[^>]*?contextRef="(OneD|OneI)"[^>]*>([^<]*)</g)) {
    const v = Number(m[3]);
    if (m[3].trim() !== '' && Number.isFinite(v) && !(m[1] in facts[m[2]])) facts[m[2]][m[1]] = v;
  }
  const q = facts.OneD, b = facts.OneI;
  const cr = (v) => (v == null ? null : Math.round((v / CR) * 100) / 100);
  const bank = q.InterestExpended != null; // lenders that are not banks also report InterestEarned
  const kind = bank ? 'B' : /NBFC/i.test(url) ? 'F' : 'N';
  const rev = bank ? q.Income ?? (q.InterestEarned ?? 0) + (q.OtherIncome ?? 0) : q.RevenueFromOperations;
  const pat = bank ? q.ProfitLossForThePeriod ?? q.ProfitLossFromOrdinaryActivitiesAfterTax : q.ProfitLossForPeriod;
  if (rev == null || pat == null) return null;
  const owners = q.ProfitOrLossAttributableToOwnersOfParent;
  const pbt = bank ? q.ProfitLossFromOrdinaryActivitiesBeforeTax : q.ProfitBeforeTax;
  const out = {
    k: kind,
    rev: cr(rev),
    pat: cr(pat),
    // the shareholders' part of the profit, where a group has minority partners
    // (banks report that share unevenly from quarter to quarter, so theirs is the whole profit)
    own: cr(!bank && owners != null && owners !== 0 ? owners : pat),
    // operating profit: before interest, depreciation, tax and other income. Not meaningful for lenders.
    op: kind === 'N' && pbt != null ? cr(pbt + (q.FinanceCosts ?? 0) + (q.DepreciationDepletionAndAmortisationExpense ?? 0) - (q.OtherIncome ?? 0)) : null,
  };
  if (b.Assets > 0) {
    const equity = bank ? (b.Capital ?? 0) + (b.ReservesAndSurplus ?? 0) : b.EquityAttributableToOwnersOfParent ?? b.Equity;
    if (equity != null && equity !== 0) {
      out.eq = cr(equity);
      if (kind === 'N') out.debt = cr((b.BorrowingsNoncurrent ?? 0) + (b.BorrowingsCurrent ?? 0));
    }
  }
  return out;
}

/** Downloads the listing and filings not yet read (at most `limit` per run). Never throws: the app works without results. */
export async function fetchResults(log, symbols, limit = Number(process.env.RESULTS_MAX) || 300) {
  await mkdir(DIR, { recursive: true });
  let index;
  try {
    index = await refreshIndex(log);
  } catch (err) {
    log(`  Could not refresh the results listing (${err.message}); using what is already downloaded.`);
    index = await readJson(INDEX, { filings: {}, old: [] });
  }
  const parsed = await readJson(PARSED, {});
  // newest quarters first; a first run is spread over several nights so no single run takes too long
  // Newest quarters first. The same quarter a year earlier comes right after the two newest, because
  // growth can't be shown without it.
  const all = [...choose(index, symbols).values()].flatMap((x) => x.filings);
  const quartersDesc = [...new Set(all.map((f) => f.q))].sort((a, b) => b - a);
  const first = [quartersDesc[0], quartersDesc[1], quartersDesc[0] - 10000, quartersDesc[1] - 10000];
  const rank = (q) => (first.includes(q) ? first.indexOf(q) : 4 + quartersDesc.indexOf(q));
  const waiting = all.filter((f) => !(f.url in parsed)).sort((a, b) => rank(a.q) - rank(b.q));
  if (!waiting.length) return;
  const todo = waiting.slice(0, limit);
  log(`  Reading ${todo.length} results filings${waiting.length > todo.length ? ` (${waiting.length - todo.length} more left for later runs)` : ''}…`);
  let done = 0, failed = 0, next = 0, refused = false;
  const save = () => writeFile(PARSED, JSON.stringify(parsed));
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < todo.length && !refused) {
        const f = todo[next++];
        try {
          const res = await fetch(f.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
          if (res.status === 403 || res.status === 429) refused = true; // asking again only prolongs a block
          else if (res.status === 404) parsed[f.url] = null;
          else if (!res.ok) throw new Error(`HTTP ${res.status}`);
          else parsed[f.url] = parseFiling(await res.text(), f.url);
        } catch {
          failed++; // left out of parsed.json, so it is tried again next time
        }
        if (++done % 500 === 0) {
          log(`  …${done} of ${todo.length}`);
          await save();
        }
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    }),
  );
  await save();
  if (refused) log('  The NSE archive refused further downloads; the rest will be read on later runs.');
  else if (failed) log(`  ${failed} filings could not be downloaded and will be retried next time`);
}

/** Loads what fetchResults() has stored: symbol -> { cons, quarters: [{ q, at, late, ...figures }] }. */
export async function loadResults() {
  const [index, parsed] = await Promise.all([readJson(INDEX, { filings: {}, old: [] }), readJson(PARSED, {})]);
  const out = new Map();
  for (const [s, { cons, filings }] of choose(index, null)) {
    const quarters = filings.filter((f) => parsed[f.url]).map((f) => ({ q: f.q, at: f.at, late: f.late, ...parsed[f.url] }));
    if (quarters.length) out.set(s, { cons, kind: quarters[quarters.length - 1].k, quarters });
  }
  return out;
}

// 20250630 -> 20250331
function quarterBefore(q) {
  const y = Math.floor(q / 10000), m = Math.floor(q / 100) % 100;
  return m <= 3 ? (y - 1) * 10000 + 1231 : y * 10000 + (m <= 6 ? 331 : m <= 9 ? 630 : 930);
}
const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : NaN);
const STALE_DAYS = 250; // no results for this long: stop quoting the old ones

/** The ratios as they stood once the filings in `known` (q -> quarter) were public. */
function ratios(known, kind) {
  const lastQ = Math.max(...known.keys());
  const last = known.get(lastQ);
  const yearAgo = known.get(lastQ - 10000);
  const out = { revYoY: NaN, patYoY: NaN, opm: NaN, roe: NaN, de: NaN, q: lastQ };
  if (yearAgo) {
    out.revYoY = pct(last.rev, yearAgo.rev);
    out.patYoY = pct(last.own, yearAgo.own);
  }
  if (last.op != null && last.rev > 0) out.opm = (last.op / last.rev) * 100;
  let balance = null, ttm = 0, q = lastQ;
  for (let i = 0; i < 4; i++, q = quarterBefore(q)) {
    const r = known.get(q);
    if (!r) { ttm = NaN; break; }
    ttm += r.own;
    if (!balance && r.eq != null) balance = r;
  }
  balance ??= known.get(q) ?? null; // the year-end before the four quarters
  if (balance?.eq > 0) {
    out.roe = (ttm / balance.eq) * 100;
    if (kind === 'N' && balance.debt != null) out.de = balance.debt / balance.eq;
  }
  return out;
}

const dayNumber = (d) => Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100) / 86400000;

/**
 * Per-session columns for the screener and the backtest engine. Each session
 * uses only the filings that were public by then (a filing made after the
 * close counts from the next session), so a backtest cannot see the future.
 */
export function resultsSeries(symbol, bars, ctx) {
  const n = bars.length;
  const out = Object.fromEntries(['revYoY', 'patYoY', 'opm', 'roe', 'de'].map((k) => [k, new Float32Array(n).fill(NaN)]));
  const co = ctx.get(symbol);
  if (!co) return out;
  const queue = [...co.quarters].sort((a, b) => a.at - b.at || a.q - b.q);
  const known = new Map();
  let i = 0, now = null;
  for (let t = 0; t < n; t++) {
    const { date } = bars[t];
    let changed = false;
    while (i < queue.length && (queue[i].late ? queue[i].at < date : queue[i].at <= date)) {
      known.set(queue[i].q, queue[i]);
      i++;
      changed = true;
    }
    if (changed) now = ratios(known, co.kind);
    if (!now || dayNumber(date) - dayNumber(now.q) > STALE_DAYS) continue;
    for (const k in out) out[k][t] = now[k];
  }
  return out;
}
