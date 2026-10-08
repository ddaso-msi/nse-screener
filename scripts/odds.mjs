// A short "macro backdrop" for the brief: what prediction markets expect on the
// few outside events that matter most to Indian stocks. Six lines at most:
// the next two US Fed decisions, US recession odds, oil, and the two most
// traded conflict risks.
//
// Source: Polymarket's public "Gamma" API (no key), one snapshot per run.
//
//   node scripts/odds.mjs
//
// Writes public/data/odds.json. Nothing here places a bet or needs an account.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/data/odds.json');
const API = 'https://gamma-api.polymarket.com';
const SLUGS = ['fed', 'economy', 'commodities', 'geopolitics'];
const MIN_VOLUME = 5000; // $ traded in the last 24 hours; below this a price is a weak signal
const MIN_HOURS_LEFT = 48;
const RISK = /iran|hormuz|invade|invasion|\bwar\b|ceasefire|blockade|taiwan|nuclear|strait/i;

const round = (x, d = 4) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d);
const dateKey = (ms) => {
  const d = new Date(ms + 5.5 * 36e5); // IST, like the rest of the app
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};
const parseList = (text) => {
  try {
    return JSON.parse(text ?? '[]');
  } catch {
    return [];
  }
};

// The connection to Polymarket drops often from some networks, so every call is retried.
async function get(query) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}/${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 6) throw new Error(`Polymarket ${query.split('?')[0]}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/** The open yes/no markets of an event, each with the chance of "yes" (0 to 1). */
function markets(e) {
  return (e.markets ?? [])
    .filter((m) => m.active && !m.closed)
    .map((m) => ({
      label: m.groupItemTitle || null,
      p: round(parseList(m.outcomePrices).map(Number)[0]),
      d1: round(m.oneDayPriceChange),
      w1: round(m.oneWeekPriceChange),
    }))
    .filter((m) => m.p != null);
}
const likeliest = (ms) => [...ms].sort((a, b) => b.p - a.p)[0];
const mostOpen = (ms) => [...ms].sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5))[0];

export async function buildOdds({ log = console.log } = {}) {
  try {
    const now = Date.now();
    const events = new Map();
    for (const slug of SLUGS) {
      for (const e of await get(`events?limit=40&closed=false&order=volume24hr&ascending=false&tag_slug=${slug}`)) {
        if ((e.volume24hr ?? 0) < MIN_VOLUME || !e.endDate || Date.parse(e.endDate) - now < MIN_HOURS_LEFT * 36e5) continue;
        if (!events.has(e.id)) events.set(e.id, e);
      }
    }
    const all = [...events.values()];
    const byVolume = (a, b) => b.volume24hr - a.volume24hr;
    const bySoonest = (a, b) => Date.parse(a.endDate) - Date.parse(b.endDate);
    const lines = [];
    const add = (topic, e, m, detail = m.label) => {
      if (!e || !m) return;
      lines.push({ topic, title: e.title, detail, p: m.p, d1: m.d1, w1: m.w1, vol: Math.round(e.volume24hr), end: dateKey(Date.parse(e.endDate)) });
    };

    // the next two Fed meetings: the outcome traders think likeliest
    for (const e of all.filter((x) => /^fed decision in/i.test(x.title)).sort(bySoonest).slice(0, 2)) add('US rates', e, likeliest(markets(e)));
    // US recession: a single yes/no question
    const recession = all.filter((x) => /recession/i.test(x.title) && markets(x).length === 1).sort(byVolume)[0];
    if (recession) add('US economy', recession, markets(recession)[0], null);
    // oil: of the price levels on offer, the one traders are least sure about
    const oil = all.filter((x) => /crude oil|\bwti\b|brent/i.test(x.title) && /hit/i.test(x.title)).sort(byVolume)[0];
    if (oil) {
      const m = mostOpen(markets(oil));
      // Polymarket labels the levels "↑ $95" / "↓ $85"
      add('Oil', oil, m, m?.label?.replace(/^↑\s*/, 'rises to ').replace(/^↓\s*/, 'falls to ') ?? null);
    }
    // conflict risk: the two busiest questions; day-by-day ladders are left out
    const risks = all.filter((x) => RISK.test(x.title) && markets(x).length >= 1 && markets(x).length <= 6 && x !== oil).sort(byVolume).slice(0, 2);
    for (const e of risks) {
      const ms = markets(e);
      add('World risk', e, mostOpen(ms), ms.length === 1 ? null : mostOpen(ms).label);
    }

    if (!lines.length) throw new Error('no matching markets found');
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify({ asOf: dateKey(now), fetchedAt: new Date(now).toISOString(), lines }));
    log(`Odds: ${lines.length} lines (${lines.map((l) => l.topic).join(', ')})`);
  } catch (err) {
    // the rest of the evening update must not depend on Polymarket answering
    const previous = await readFile(OUT, 'utf8').then(() => 'keeping the previous snapshot', () => 'none shown');
    log(`Odds: not updated (${err.message}); ${previous}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildOdds();
