import presets from './presets.json';

/** True in the deployed build, where there is no local server to refresh data or run backtests. */
export const HOSTED = import.meta.env.PROD;

export interface Row {
  s: string;
  name: string;
  sector: string | null;
  idx: string | null;
  series: string;
  close: number;
  chg: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
  m6: number | null;
  y1: number | null;
  hi52: number;
  lo52: number;
  fromHi: number | null;
  fromLo: number | null;
  newHi: 0 | 1;
  newLo: 0 | 1;
  vs20: number | null;
  vs50: number | null;
  vs200: number | null;
  cross: -1 | 0 | 1;
  rsi: number | null;
  vol: number;
  volX: number | null;
  turnover: number;
  avgTurnover: number;
  deliv: number | null;
  delivAvg: number | null;
  sessions: number;
  spark: number[];
  ca: number;
  /** Relative strength: 1-99 rank of weighted 3/6/9/12-month return across all stocks */
  rs: number | null;
  /** Market cap, ₹ Cr */
  mcap: number | null;
  pe: number | null;
  eps: number | null;
  /** Trailing earnings vs a year earlier, % */
  epsG: number | null;
  /** Dividends with an ex-date in the last 12 months / price, % */
  divY: number | null;
  /** L / M / S by market-cap rank (top 100, next 150, rest) */
  cap: 'L' | 'M' | 'S' | null;
  nextEx: { ex: number; text: string } | null;
  /** 1 if the stock has futures and options */
  fo: 0 | 1;
  /** Futures open interest change today / over 5 sessions, % */
  foOiChg: number | null;
  oi5: number | null;
  /** Put OI / call OI */
  pcr: number | null;
  /** At-the-money implied volatility, %, and where it ranks against the past year (0-100) */
  iv: number | null;
  ivRank: number | null;
  /** LB long build-up, SB short build-up, SC short covering, LU long unwinding */
  build: 'LB' | 'SB' | 'SC' | 'LU' | null;
  ban: 0 | 1;
  /** Next board meeting on or after the latest session */
  bm: { date: number; purpose: string; results: boolean } | null;
  /** Subjects of material filings made on the latest session */
  filed: string[];
}

export const BUILD_LABEL = { LB: 'Long build-up', SB: 'Short build-up', SC: 'Short covering', LU: 'Long unwinding' } as const;

export interface Dataset {
  asOf: number;
  generatedAt: string;
  sessions: number;
  indices: { code: string; label: string }[];
  rows: Row[];
}

export interface History {
  d: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  dl: (number | null)[];
  ca: { date: number; ratio: number; kind: string; text: string | null }[];
  acts: { ex: number; text: string }[];
}

export type NumKey =
  | 'close' | 'chg' | 'w1' | 'm1' | 'm3' | 'm6' | 'y1'
  | 'fromHi' | 'fromLo' | 'vs20' | 'vs50' | 'vs200'
  | 'rsi' | 'volX' | 'deliv' | 'avgTurnover' | 'turnover'
  | 'mcap' | 'pe' | 'epsG' | 'divY' | 'rs'
  | 'foOiChg' | 'oi5' | 'pcr' | 'ivRank';

export type Flag = 'newHi' | 'newLo' | 'golden' | 'death' | 'longBuild' | 'shortBuild' | 'shortCover' | 'longUnwind';

export interface Filters {
  q: string;
  universe: string;
  sector: string;
  flags: Flag[];
  ranges: Partial<Record<NumKey, [number | null, number | null]>>;
}

export const EMPTY: Filters = { q: '', universe: 'ALL', sector: '', flags: [], ranges: {} };

export const UNIVERSES: { code: string; label: string; has: (idx: string | null, row: Row) => boolean }[] = [
  { code: 'ALL', label: 'All NSE stocks', has: () => true },
  { code: 'N50', label: 'Nifty 50', has: (i) => i === 'N50' },
  { code: 'NN50', label: 'Nifty Next 50', has: (i) => i === 'NN50' },
  { code: 'N100', label: 'Nifty 100', has: (i) => i === 'N50' || i === 'NN50' },
  { code: 'MID150', label: 'Nifty Midcap 150', has: (i) => i === 'MID150' },
  { code: 'SML250', label: 'Nifty Smallcap 250', has: (i) => i === 'SML250' },
  { code: 'N500', label: 'Nifty 500', has: (i) => i != null && i !== 'MIC250' },
  { code: 'MIC250', label: 'Nifty Microcap 250', has: (i) => i === 'MIC250' },
  { code: 'OTHER', label: 'Outside the indices', has: (i) => i == null },
  { code: 'FNO', label: 'F&O stocks', has: (_i, r) => r.fo === 1 },
];

export const CAP_LABEL = { L: 'Large cap', M: 'Mid cap', S: 'Small cap' } as const;

/** ₹ Cr -> "₹15.8 L Cr" / "₹2,182 Cr" */
export function fmtMcap(v: number | null | undefined) {
  if (v == null) return '–';
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L Cr`;
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: v >= 100 ? 0 : 1 }).format(v)} Cr`;
}

export const IDX_LABEL: Record<string, string> = {
  N50: 'Nifty 50',
  NN50: 'Next 50',
  MID150: 'Midcap',
  SML250: 'Smallcap',
  MIC250: 'Microcap',
};

export interface FieldDef {
  key: NumKey;
  label: string;
  unit: string;
  hint?: string;
}

export const FIELD_GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Price & liquidity',
    fields: [
      { key: 'close', label: 'Price', unit: '₹' },
      { key: 'avgTurnover', label: 'Avg daily turnover', unit: '₹ Cr', hint: '20-session average traded value' },
    ],
  },
  {
    title: 'Fundamentals',
    fields: [
      { key: 'mcap', label: 'Market cap', unit: '₹ Cr' },
      { key: 'pe', label: 'P/E', unit: '', hint: 'NSE trailing P/E. Loss-making companies have none and are excluded by any P/E filter.' },
      { key: 'epsG', label: 'Earnings growth 1Y', unit: '%', hint: 'Trailing 12-month earnings vs a year earlier' },
      { key: 'divY', label: 'Dividend yield', unit: '%', hint: 'Dividends that went ex in the last 12 months / price' },
    ],
  },
  {
    title: 'Derivatives (F&O stocks)',
    fields: [
      { key: 'foOiChg', label: 'Futures OI change', unit: '%', hint: 'Change in futures open interest today, all expiries combined' },
      { key: 'oi5', label: 'Futures OI, 5 sessions', unit: '%' },
      { key: 'pcr', label: 'Put/call ratio', unit: '', hint: 'Put open interest divided by call open interest' },
      { key: 'ivRank', label: 'IV rank', unit: '', hint: '0–100: share of the past year when implied volatility was lower than today. High = options are expensive.' },
    ],
  },
  {
    title: 'Returns',
    fields: [
      { key: 'chg', label: 'Day change', unit: '%' },
      { key: 'w1', label: '1 week', unit: '%' },
      { key: 'm1', label: '1 month', unit: '%' },
      { key: 'm3', label: '3 months', unit: '%' },
      { key: 'm6', label: '6 months', unit: '%' },
      { key: 'y1', label: '1 year', unit: '%' },
    ],
  },
  {
    title: 'Trend',
    fields: [
      { key: 'vs20', label: 'Price vs 20 DMA', unit: '%' },
      { key: 'vs50', label: 'Price vs 50 DMA', unit: '%' },
      { key: 'vs200', label: 'Price vs 200 DMA', unit: '%' },
      { key: 'fromHi', label: 'From 52W high', unit: '%', hint: '0 = at the high, −20 = 20% below it' },
      { key: 'fromLo', label: 'Above 52W low', unit: '%' },
    ],
  },
  {
    title: 'Momentum & volume',
    fields: [
      { key: 'rs', label: 'Relative strength', unit: '', hint: '1–99: the share of stocks this one has outperformed over the past year, recent months weighted more' },
      { key: 'rsi', label: 'RSI (14)', unit: '' },
      { key: 'volX', label: 'Volume vs 20D avg', unit: '×' },
      { key: 'deliv', label: 'Delivery', unit: '%', hint: 'Share of traded quantity taken for delivery' },
    ],
  },
];

export const FLAGS: { key: Flag; label: string; test: (r: Row) => boolean }[] = [
  { key: 'newHi', label: 'New 52W high today', test: (r) => r.newHi === 1 },
  { key: 'newLo', label: 'New 52W low today', test: (r) => r.newLo === 1 },
  { key: 'golden', label: 'Golden cross (last 10 sessions)', test: (r) => r.cross === 1 },
  { key: 'death', label: 'Death cross (last 10 sessions)', test: (r) => r.cross === -1 },
  { key: 'longBuild', label: 'Futures: long build-up today', test: (r) => r.build === 'LB' },
  { key: 'shortBuild', label: 'Futures: short build-up today', test: (r) => r.build === 'SB' },
  { key: 'shortCover', label: 'Futures: short covering today', test: (r) => r.build === 'SC' },
  { key: 'longUnwind', label: 'Futures: long unwinding today', test: (r) => r.build === 'LU' },
];

export interface Preset {
  id: string;
  label: string;
  blurb: string;
  filters: Partial<Filters>;
  sort: [keyof Row, 1 | -1];
}

// Shared with scripts/backtest.mjs so the backtest tests exactly what the app screens for.
export const PRESETS = presets as Preset[];

const fieldByKey = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields).map((f) => [f.key, f]));

export function describeRange(key: NumKey, [min, max]: [number | null, number | null]) {
  const f = fieldByKey[key];
  const u = (v: number) => (f.unit === '₹' ? `₹${v}` : f.unit === '₹ Cr' ? `₹${v} Cr` : `${v}${f.unit}`);
  if (min != null && max != null) return `${f.label} ${u(min)} to ${u(max)}`;
  return min != null ? `${f.label} ≥ ${u(min)}` : `${f.label} ≤ ${u(max!)}`;
}


/** Plain-language list of everything a filter set asks for. */
export function describeFilters(f: Filters): string[] {
  const out: string[] = [];
  if (f.universe !== 'ALL') out.push(UNIVERSES.find((u) => u.code === f.universe)?.label ?? f.universe);
  if (f.sector) out.push(f.sector);
  for (const k of f.flags) out.push(FLAGS.find((x) => x.key === k)!.label);
  for (const [k, r] of Object.entries(f.ranges) as [NumKey, [number | null, number | null]][]) out.push(describeRange(k, r));
  return out;
}

export function applyFilters(rows: Row[], f: Filters): Row[] {
  const q = f.q.trim().toUpperCase();
  const universe = UNIVERSES.find((u) => u.code === f.universe) ?? UNIVERSES[0];
  const flags = FLAGS.filter((x) => f.flags.includes(x.key));
  const ranges = Object.entries(f.ranges).filter(([, r]) => r && (r[0] != null || r[1] != null)) as [
    NumKey,
    [number | null, number | null],
  ][];
  return rows.filter((r) => {
    if (q && !r.s.includes(q) && !r.name.toUpperCase().includes(q)) return false;
    if (!universe.has(r.idx, r)) return false;
    if (f.sector && r.sector !== f.sector) return false;
    for (const flag of flags) if (!flag.test(r)) return false;
    for (const [key, [min, max]] of ranges) {
      const v = r[key];
      if (v == null) return false;
      if (min != null && v < min) return false;
      if (max != null && v > max) return false;
    }
    return true;
  });
}

export function sortRows(rows: Row[], key: keyof Row, dir: 1 | -1): Row[] {
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1; // blanks always last
    if (y == null) return -1;
    if (typeof x === 'string') return dir * x.localeCompare(y as string);
    return dir * ((x as number) - (y as number));
  });
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const fmtPrice = (v: number | null | undefined) => (v == null ? '–' : inr.format(v));
export const fmtInt = (v: number | null | undefined) => (v == null ? '–' : int.format(v));
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;
export const fmtCr = (v: number | null | undefined) =>
  v == null ? '–' : v >= 100 ? int.format(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
export function fmtQty(v: number | null | undefined) {
  if (v == null) return '–';
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  return int.format(v);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 20261001 -> "1 Oct 2026"
export function fmtDate(key: number, withYear = true) {
  const y = Math.floor(key / 10000);
  const m = Math.floor(key / 100) % 100;
  return `${key % 100} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}
export const monthOf = (key: number) => MONTHS[(Math.floor(key / 100) % 100) - 1];

export const fileSafe = (symbol: string) => symbol.replace(/[^A-Za-z0-9]/g, '_');

export function toCsv(rows: Row[]) {
  const cols: [string, keyof Row][] = [
    ['Symbol', 's'], ['Company', 'name'], ['Sector', 'sector'], ['Index', 'idx'], ['Close', 'close'],
    ['Day %', 'chg'], ['1W %', 'w1'], ['1M %', 'm1'], ['3M %', 'm3'], ['6M %', 'm6'], ['1Y %', 'y1'],
    ['Market Cap Cr', 'mcap'], ['P/E', 'pe'], ['EPS', 'eps'], ['Earnings Growth 1Y %', 'epsG'], ['Dividend Yield %', 'divY'],
    ['Relative Strength', 'rs'], ['Futures OI Chg %', 'foOiChg'], ['Futures Position', 'build'], ['Put/Call Ratio', 'pcr'], ['IV %', 'iv'], ['IV Rank', 'ivRank'], ['RSI 14', 'rsi'], ['vs 20DMA %', 'vs20'], ['vs 50DMA %', 'vs50'], ['vs 200DMA %', 'vs200'],
    ['52W High', 'hi52'], ['52W Low', 'lo52'], ['From 52W High %', 'fromHi'], ['Volume', 'vol'],
    ['Volume x 20D avg', 'volX'], ['Delivery %', 'deliv'], ['Avg Turnover Cr', 'avgTurnover'],
  ];
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map((c) => cell(r[c[1]])).join(','))].join('\n');
}
