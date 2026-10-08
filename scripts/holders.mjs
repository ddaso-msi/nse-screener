// Who owns and who is trading: the official disclosures that show what large
// holders are doing.
//
// From www.nseindia.com/api (the listings, not the archive):
//   historicalOR/bulk-block-short-deals   bulk and block deals, with the client's name
//   corporate-sast-reg29                  share purchases and sales disclosed by promoters and large holders
//   corporate-share-holdings-master       promoter holding at each quarter end
//   corporate-pledgedata                  promoter shares pledged
//   fiidiiTradeReact                      the day's net buying by foreign and domestic institutions
//
// Kept in data/raw/holders/state.json (a year of deals and disclosures, two
// years of quarter-end holdings). The institutions' daily flows have no history
// feed, so Sensa keeps its own in data/user/flows.json, which the evening job
// commits to the repository.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nseApi } from './results.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/raw/holders');
const STATE = path.join(DIR, 'state.json');
const FLOWS = path.join(ROOT, 'data/user/flows.json');
const KEEP_DAYS = 370;
const SHP_BACK_DAYS = 800;
const PAUSE_MS = 700;
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

const readJson = (file, fallback) => readFile(file, 'utf8').then(JSON.parse, () => fallback);
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));
const num = (x) => {
  const v = Number(String(x ?? '').replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};
// "08-OCT-2026 10:18:33" or "08-Oct-2026, 12-41" -> 20261008
function dateOf(text) {
  const m = /(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(text ?? '');
  return m && MONTHS[m[2].toUpperCase()] ? Number(m[3]) * 10000 + MONTHS[m[2].toUpperCase()] * 100 + Number(m[1]) : null;
}
const toMs = (k) => Date.UTC(Math.floor(k / 10000), (Math.floor(k / 100) % 100) - 1, k % 100);
const toKey = (ms) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};
const param = (k) => `${String(k % 100).padStart(2, '0')}-${String(Math.floor(k / 100) % 100).padStart(2, '0')}-${Math.floor(k / 10000)}`;
const todayKey = () => toKey(Date.now() + 5.5 * 36e5);

/** [from, to] windows of at most `days` days covering `from`..`to`, oldest first. */
function windows(from, to, days) {
  const out = [];
  for (let a = toMs(from); a <= toMs(to); a += days * 864e5) out.push([toKey(a), toKey(Math.min(a + (days - 1) * 864e5, toMs(to)))]);
  return out;
}

const emptyState = () => ({ deals: [], sast: [], shp: {}, pledge: [], dealsTo: null, sastTo: null, shpTo: null });

/** Brings the stored disclosures up to date. Never throws: the app works without them. */
export async function fetchHolders(log) {
  await mkdir(DIR, { recursive: true });
  const state = { ...emptyState(), ...(await readJson(STATE, {})) };
  const today = todayKey();
  const since = (last, back) => toKey(last ? toMs(last) - 3 * 864e5 : toMs(today) - back * 864e5);
  let fresh = 0;
  try {
    // bulk and block deals
    const haveDeal = new Set(state.deals.map((d) => `${d.d}|${d.s}|${d.who}|${d.side}|${d.qty}|${d.kind}`));
    for (const [from, to] of windows(since(state.dealsTo, KEEP_DAYS), today, 30)) {
      for (const kind of ['bulk', 'block']) {
        const res = await nseApi(`historicalOR/bulk-block-short-deals?optionType=${kind}_deals&from=${param(from)}&to=${param(to)}`);
        for (const r of res.data ?? []) {
          const d = { d: dateOf(r.BD_DT_DATE), s: r.BD_SYMBOL, who: String(r.BD_CLIENT_NAME ?? '').trim(), side: r.BD_BUY_SELL === 'BUY' ? 'B' : 'S', qty: num(r.BD_QTY_TRD), px: num(r.BD_TP_WATP), kind };
          const key = `${d.d}|${d.s}|${d.who}|${d.side}|${d.qty}|${d.kind}`;
          if (!d.d || !d.s || !d.qty || haveDeal.has(key)) continue;
          haveDeal.add(key);
          state.deals.push(d);
          fresh++;
        }
        await pause();
      }
      state.dealsTo = to;
    }

    // purchases and sales disclosed by promoters and holders of large stakes
    const haveSast = new Set(state.sast.map((x) => x.id));
    for (const [from, to] of windows(since(state.sastTo, KEEP_DAYS), today, 30)) {
      const res = await nseApi(`corporate-sast-reg29?index=equities&from_date=${param(from)}&to_date=${param(to)}`);
      for (const r of res.data ?? res ?? []) {
        const id = String(r.application_no ?? `${r.symbol}|${r.timestamp}|${r.acquirerName}`);
        const shares = num(r.noOfShareAcq) ?? num(r.noOfShareSale);
        if (haveSast.has(id) || !r.symbol || !shares) continue;
        haveSast.add(id);
        state.sast.push({ id, d: dateOf(r.timestamp), s: r.symbol, who: String(r.acquirerName ?? '').trim(), prom: r.promoterType === 'Y' ? 1 : 0, sell: /sale/i.test(r.acqSaleType ?? '') ? 1 : 0, shares, after: num(r.totAftShare), mode: r.acquisitionMode ?? null });
        fresh++;
      }
      state.sastTo = to;
      await pause();
    }

    // promoter holding at each quarter end (the listing carries it, so no filing needs opening)
    for (const [from, to] of windows(since(state.shpTo, SHP_BACK_DAYS), today, 60)) {
      const list = await nseApi(`corporate-share-holdings-master?index=equities&from_date=${param(from)}&to_date=${param(to)}`);
      for (const r of Array.isArray(list) ? list : []) {
        const q = dateOf(r.date), pct = num(r.pr_and_prgrp);
        if (!r.symbol || !q || pct == null) continue;
        (state.shp[r.symbol] ??= {})[q] = pct;
      }
      state.shpTo = to;
      await pause();
    }
    for (const s of Object.keys(state.shp)) {
      const keep = Object.keys(state.shp[s]).map(Number).sort((a, b) => b - a).slice(0, 8);
      state.shp[s] = Object.fromEntries(keep.map((q) => [q, state.shp[s][q]]));
    }

    // pledged promoter shares: a full snapshot each time
    const pledge = await nseApi('corporate-pledgedata?index=equities');
    if (pledge.data?.length) {
      state.pledge = pledge.data.map((r) => {
        const held = num(r.totPromoterHolding), pledged = num(r.numSharesPledged);
        return { name: r.comName, pct: held > 0 && pledged != null ? Math.round((pledged / held) * 1000) / 10 : null, at: dateOf(r.broadcastDt) };
      }).filter((r) => r.pct != null);
    }
  } catch (err) {
    log(`  Ownership disclosures only partly updated (${err.message}).`);
  }
  const cutoff = toKey(toMs(today) - KEEP_DAYS * 864e5);
  state.deals = state.deals.filter((d) => d.d >= cutoff);
  state.sast = state.sast.filter((d) => d.d >= cutoff);
  await writeFile(STATE, JSON.stringify(state));

  // the institutions' net buying today; added to Sensa's own running record
  try {
    const flows = await readJson(FLOWS, {});
    for (const r of await nseApi('fiidiiTradeReact')) {
      const d = dateOf(r.date), net = num(r.netValue);
      if (!d || net == null) continue;
      (flows[d] ??= {})[/^fii/i.test(r.category) ? 'fii' : 'dii'] = net;
    }
    await mkdir(path.dirname(FLOWS), { recursive: true });
    await writeFile(FLOWS, JSON.stringify(Object.fromEntries(Object.entries(flows).sort(([a], [b]) => a - b)), null, 1));
  } catch (err) {
    log(`  Institutional flows not updated (${err.message}).`);
  }
  log(`  ownership: ${fresh} new deals and disclosures, ${Object.keys(state.shp).length} companies with promoter holdings`);
}

const plainName = (s) => String(s ?? '').toLowerCase().replace(/\b(limited|ltd|the)\b|[^a-z0-9]/g, '');

/** What fetchHolders() stored, arranged per stock. `names` maps symbol -> company name (for the pledge list, which has no symbols). */
export async function loadHolders(names) {
  const state = { ...emptyState(), ...(await readJson(STATE, {})) };
  const group = (list) => {
    const out = new Map();
    for (const x of [...list].sort((a, b) => b.d - a.d)) (out.get(x.s) ?? out.set(x.s, []).get(x.s)).push(x);
    return out;
  };
  const pledgeByName = new Map(state.pledge.map((p) => [plainName(p.name), p.pct]));
  const flows = Object.entries(await readJson(FLOWS, {})).map(([d, v]) => ({ d: Number(d), fii: v.fii ?? null, dii: v.dii ?? null })).sort((a, b) => a.d - b.d);
  return {
    deals: group(state.deals),
    sast: group(state.sast),
    flows,
    /** Promoter holding by quarter (oldest first), the latest change in points, and the share of it pledged. */
    of(symbol) {
      const prom = Object.entries(state.shp[symbol] ?? {}).map(([q, pct]) => [Number(q), pct]).sort((a, b) => a[0] - b[0]);
      const last = prom[prom.length - 1], prev = prom[prom.length - 2];
      return {
        prom,
        promPct: last ? last[1] : null,
        promChg: last && prev ? Math.round((last[1] - prev[1]) * 100) / 100 : null,
        pledge: pledgeByName.get(plainName(names.get(symbol))) ?? null,
      };
    },
  };
}
