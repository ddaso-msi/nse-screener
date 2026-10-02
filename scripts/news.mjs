// News for the app, from two kinds of source:
//
//   Company filings   NSE's daily announcements and board-meeting files (inside
//                     PRddmmyy.zip). Primary-source and tagged by symbol.
//   Market headlines  publishers' public RSS feeds. Only the headline, a short
//                     blurb, the source and a link are kept; articles are
//                     never fetched or stored.
//
// Writes public/data/news.json (headlines, material filings, results calendar)
// and public/data/n/<SYMBOL>.json (each stock's recent filings and meetings).

import { mkdir, readFile, readdir, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, unzip } from './fundamentals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data');
const DIRS = { ann: path.join(RAW, 'ann'), bm: path.join(RAW, 'bm') };
const SESSIONS = 12; // how far back filings are kept per stock
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const FEEDS = [
  ['Economic Times', 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'],
  ['Economic Times', 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms'],
  ['Mint', 'https://www.livemint.com/rss/markets'],
  ['Business Standard', 'https://www.business-standard.com/rss/markets-106.rss'],
  ['BusinessLine', 'https://www.thehindubusinessline.com/markets/feeder/default.rss'],
  ['CNBC-TV18', 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml'],
];
const HEADLINE_DAYS = 3;
const MAX_HEADLINES = 150;

// Filings worth surfacing. Everything else (AGM notices, newspaper clippings,
// trading-window closures, certificates…) is routine paperwork.
const MATERIAL = /financial result|dividend|bonus|split|buy ?back|acquisition|amalgamation|merger|demerger|scheme of arrangement|order|contract|credit rating|pledge|encumbr|fund rais|preferential|rights issue|qip|resignation|appointment of|press release|investor presentation|outcome of board|allotment|delisting|open offer|insolvency|default|litigation|award|joint venture|capacity|expansion/i;
const ROUTINE = /newspaper|trading window|certificate|scrutini[sz]er|shareholders? meeting|agm|egm|postal ballot|loss of share|duplicate share|book closure|record date|analysts?\/institutional|investor meet|copy of|intimation of|closure of trading/i;

const exists = (p) => stat(p).then(() => true, () => false);
const tagDate = (tag) => Number(tag.slice(4)) * 10000 + Number(tag.slice(2, 4)) * 100 + Number(tag.slice(0, 2));
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fileSafe = (symbol) => symbol.replace(/[^A-Za-z0-9]/g, '_');

async function recentTags(count) {
  return (await readdir(RAW))
    .filter((f) => /^\d{8}\.csv$/.test(f))
    .map((f) => f.slice(0, 8))
    .sort((a, b) => tagDate(a) - tagDate(b))
    .slice(-count);
}

/** Makes sure the announcement and board-meeting files exist for the last few sessions. */
export async function fetchFilings(log = () => {}) {
  for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true });
  const tags = await recentTags(SESSIONS);
  let fetched = 0;
  for (const tag of tags) {
    if ((await exists(path.join(DIRS.ann, `${tag}.txt`))) && (await exists(path.join(DIRS.bm, `${tag}.txt`)))) continue;
    const zip = await download(`https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR${tag.slice(0, 4)}${tag.slice(6)}.zip`).catch(() => null);
    const files = zip ? unzip(zip) : {};
    const pick = (re) => Object.entries(files).find(([name]) => re.test(name))?.[1];
    const ann = pick(/^an\d+\.txt$/);
    const bm = pick(/^bm\d+\.txt$/);
    const old = tag !== tags[tags.length - 1]; // the latest may simply not be published yet
    if (ann || old) await writeFile(path.join(DIRS.ann, `${tag}.txt`), ann ?? '');
    if (bm || old) await writeFile(path.join(DIRS.bm, `${tag}.txt`), bm ?? '');
    fetched++;
  }
  // drop files that have aged out of the window
  for (const dir of Object.values(DIRS)) {
    for (const f of await readdir(dir)) if (!tags.includes(f.slice(0, 8))) await rm(path.join(dir, f));
  }
  log(`  ${fetched} filings file(s) requested`);
  return tags;
}

// Both files are free text: "<Company name> <SYMBOL> : <rest>", with long
// entries continuing on following lines. An entry starts wherever a line has a
// known symbol immediately before " : ".
function entries(text, names) {
  const out = [];
  let open = false; // false while inside an entry for a symbol we don't track (SME listings, debt)
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = /^(.*?)\s+([A-Z0-9&_.-]+)\s+:\s+(.*)$/.exec(line);
    if (m) {
      open = names.has(m[2]);
      if (open) out.push({ s: m[2], rest: m[3].trim() });
    } else if (open && line.trim()) out[out.length - 1].rest += ` ${line.trim()}`;
  }
  return out;
}

export function parseAnnouncements(text, names) {
  return entries(text, names).map(({ s, rest }) => {
    // "<Subject> SYMBOL : <body>" or "<Subject> <Company name> has informed…"
    let subject = '', body = rest;
    const tagAt = rest.indexOf(` ${s} : `);
    const nameAt = rest.toLowerCase().indexOf(names.get(s).toLowerCase());
    if (tagAt > 0) { subject = rest.slice(0, tagAt); body = rest.slice(tagAt + s.length + 4); }
    else if (nameAt > 0) { subject = rest.slice(0, nameAt); body = rest.slice(nameAt); }
    subject = subject.trim() || 'Announcement';
    const material = MATERIAL.test(subject) && !ROUTINE.test(subject);
    return { s, subject: clip(subject, 90), text: clip(body.replace(/\s+/g, ' ').trim(), 280), key: material };
  });
}

const TOPICS = /^(?:(?:Financial Results|Dividend|Bonus|Fund Raising|Buy ?back|Stock Split|Rights Issue|Preferential Issue|Voluntary Delisting|Scheme of Arrangement|Other business matters)(?:\/|\s+|$))+/i;

export function parseBoardMeetings(text, names) {
  const out = [];
  for (const { s, rest } of entries(text, names)) {
    const m = /^(\d{2})-([A-Z]{3})-(\d{4})\s*:\s*(.*)$/i.exec(rest);
    if (!m) continue;
    const date = Number(m[3]) * 10000 + MONTHS[m[2].toUpperCase()] * 100 + Number(m[1]);
    const purpose = m[4].replace(/\s+/g, ' ').trim();
    // the purpose leads with slash-separated topics, then repeats them as a sentence
    const topics = TOPICS.exec(purpose)?.[0].replace(/[\s/]+$/, '') || purpose;
    out.push({ s, date, purpose: clip(topics, 80), results: /financial result/i.test(purpose) });
  }
  return out;
}

/** Everything known from filings: per-symbol announcements and board meetings over the kept window. */
export async function loadFilings(names) {
  const bySymbol = new Map();
  const of = (s) => bySymbol.get(s) ?? bySymbol.set(s, { filings: [], meetings: [] }).get(s);
  const seenMeeting = new Set();
  for (const f of (await readdir(DIRS.ann).catch(() => [])).sort((a, b) => tagDate(b.slice(0, 8)) - tagDate(a.slice(0, 8)))) {
    const date = tagDate(f.slice(0, 8));
    const seen = new Set();
    for (const a of parseAnnouncements(await readFile(path.join(DIRS.ann, f), 'utf8'), names)) {
      const key = `${a.s}|${a.subject}|${a.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      of(a.s).filings.push({ date, ...a });
    }
  }
  for (const f of (await readdir(DIRS.bm).catch(() => [])).sort((a, b) => tagDate(b.slice(0, 8)) - tagDate(a.slice(0, 8)))) {
    for (const b of parseBoardMeetings(await readFile(path.join(DIRS.bm, f), 'utf8'), names)) {
      const key = `${b.s}|${b.date}`;
      if (seenMeeting.has(key)) continue; // newest notice wins
      seenMeeting.add(key);
      of(b.s).meetings.push(b);
    }
  }
  for (const v of bySymbol.values()) v.meetings.sort((a, b) => a.date - b.date);
  return bySymbol;
}

// ---------- RSS ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…' };
const plain = (s) =>
  (s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
const field = (item, name) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(item)?.[1];

async function fetchHeadlines(log) {
  const since = Date.now() - HEADLINE_DAYS * 864e5;
  const all = [];
  await Promise.all(
    FEEDS.map(async ([source, url]) => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        for (const item of xml.split(/<item[\s>]/i).slice(1)) {
          const title = plain(field(item, 'title'));
          const link = plain(field(item, 'link'));
          const at = Date.parse(plain(field(item, 'pubDate')));
          if (!title || !/^https?:\/\//.test(link) || !(at >= since)) continue;
          all.push({ at, title, link, source, blurb: clip(plain(field(item, 'description')), 170) });
        }
      } catch (err) {
        log(`  ${source} feed skipped (${err.message})`);
      }
    }),
  );
  const seen = new Set();
  return all
    .sort((a, b) => b.at - a.at)
    .filter((h) => {
      const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_HEADLINES)
    .map((h) => (h.blurb.toLowerCase().startsWith(h.title.toLowerCase().slice(0, 40)) ? { ...h, blurb: '' } : h));
}

/**
 * @param names   Map(symbol -> company name) for every listed company
 * @param filings result of loadFilings()
 * @param asOf    latest session, YYYYMMDD
 */
export async function buildNews({ names, filings, asOf, log = () => {} }) {
  const headlines = await fetchHeadlines(log);
  await rm(path.join(OUT, 'n'), { recursive: true, force: true });
  await mkdir(path.join(OUT, 'n'), { recursive: true });

  const material = [];
  const calendar = [];
  for (const [s, v] of filings) {
    await writeFile(path.join(OUT, 'n', `${fileSafe(s)}.json`), JSON.stringify(v));
    for (const f of v.filings) if (f.key) material.push({ ...f, name: names.get(s) });
    for (const m of v.meetings) if (m.date >= asOf) calendar.push({ ...m, name: names.get(s) });
  }
  const sessions = [...new Set(material.map((f) => f.date))].sort((a, b) => b - a).slice(0, 3);
  const news = {
    asOf,
    generatedAt: new Date().toISOString(),
    headlines,
    filings: material.filter((f) => sessions.includes(f.date)).sort((a, b) => b.date - a.date || a.s.localeCompare(b.s)),
    calendar: calendar.sort((a, b) => a.date - b.date || a.s.localeCompare(b.s)),
  };
  await writeFile(path.join(OUT, 'news.json'), JSON.stringify(news));
  log(`News: ${headlines.length} headlines, ${news.filings.length} material filings, ${calendar.length} upcoming board meetings`);
  return news;
}
