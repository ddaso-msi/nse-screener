// Runs a custom backtest in the browser, with the same engine the server uses
// (scripts/engine-core.mjs), on history packed by scripts/pack.mjs. Only the
// columns a backtest needs are downloaded, and they stay in memory for the
// next run.

import { FLAGS, run, type EngineSymbol, type Universe } from '../scripts/engine-core.mjs';
import type { Filters } from './data';

interface Meta {
  asOf: number;
  dates: number[];
  bars: number;
  flags: string[];
  metrics: Record<string, { type: 'f32' | 'i16'; scale?: number }>;
  symbols: { s: string; idx: string | null; sector: string | null; fo: number; n: number }[];
}

let meta: Promise<Meta> | null = null;
let universe: Universe | null = null;
const columns = new Map<string, Promise<ArrayBuffer>>();
const offsets: number[] = [];

const column = (name: string) => {
  let p = columns.get(name);
  if (!p) {
    p = fetch(`/data/bt/${name}.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('The backtest history has not been published yet.'))));
    columns.set(name, p);
    p.catch(() => columns.delete(name));
  }
  return p;
};

/** Rough download size for a backtest, in MB, counting only columns not yet loaded. */
export function downloadSize(m: Meta | null, needed: string[]) {
  if (!m) return null;
  const bytes = needed.filter((n) => !columns.has(n)).reduce((sum, n) => {
    const metric = n.startsWith('m-') ? m.metrics[n.slice(2)] : null;
    const width = n === 'day' || n === 'flags' || metric?.type === 'i16' ? 2 : 4;
    return sum + m.bars * width;
  }, 0);
  return Math.round(bytes / 1e6);
}

function neededColumns(filters: Filters, exits: boolean) {
  const need = ['day', 'o', 'c', 'm-avgTurnover'];
  for (const k of Object.keys(filters.ranges ?? {})) need.push(`m-${k}`);
  if ((filters.flags ?? []).length) need.push('flags');
  if (exits) need.push('h', 'l');
  return [...new Set(need)];
}

export const loadMeta = (): Promise<Meta> => (meta ??= fetch('/data/bt/meta.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('The backtest history has not been published yet.')))));

export async function sizeFor(filters: Filters, exits: boolean) {
  return downloadSize(await loadMeta().catch(() => null), neededColumns(filters, exits));
}

export async function runClientBacktest(opts: { filters: Filters; hold: number; stop: number | null; target: number | null; cost: number }) {
  const m = await loadMeta();
  const need = neededColumns(opts.filters, opts.stop != null || opts.target != null);
  const unknown = need.filter((n) => n.startsWith('m-') && !m.metrics[n.slice(2)]);
  if (unknown.length) throw new Error(`This screen uses a measure the backtest can't replay: ${unknown.map((n) => n.slice(2)).join(', ')}.`);
  const buffers = await Promise.all(need.map(column));

  if (!universe) {
    let at = 0;
    const symbols: EngineSymbol[] = m.symbols.map((s) => {
      offsets.push(at);
      at += s.n;
      return { ...s, fo: !!s.fo, etf: false, date: new Int32Array(0), o: new Float32Array(0), h: new Float32Array(0), l: new Float32Array(0), c: new Float32Array(0), m: {}, f: {} };
    });
    universe = { dates: m.dates, symbols, base: new Map() };
  }
  const u = universe;
  const each = (apply: (sym: EngineSymbol, from: number, to: number) => void) => u.symbols.forEach((sym, i) => apply(sym, offsets[i], offsets[i] + sym.n));

  need.forEach((name, i) => {
    const buf = buffers[i];
    if (name === 'day') {
      if (u.symbols[0].date.length) return;
      const dates = Int32Array.from(new Uint16Array(buf), (d) => m.dates[d]);
      each((sym, a, b) => { sym.date = dates.subarray(a, b); });
    } else if (name === 'o' || name === 'h' || name === 'l' || name === 'c') {
      if (u.symbols[0][name].length) return;
      const all = new Float32Array(buf);
      each((sym, a, b) => { sym[name] = all.subarray(a, b); });
    } else if (name === 'flags') {
      const mask = new Uint16Array(buf);
      for (const flag of opts.filters.flags ?? []) {
        const bit = m.flags.indexOf(flag);
        if (bit < 0 || !FLAGS.includes(flag) || u.symbols[0].f[flag]) continue;
        const all = Uint8Array.from(mask, (v) => (v >> bit) & 1);
        each((sym, a, b) => { sym.f[flag] = all.subarray(a, b); });
      }
    } else {
      const key = name.slice(2);
      if (u.symbols[0].m[key]) return;
      const spec = m.metrics[key];
      const all = spec.type === 'f32' ? new Float32Array(buf) : Float32Array.from(new Int16Array(buf), (v) => (v === -32768 ? NaN : v / spec.scale!));
      each((sym, a, b) => { sym.m[key] = all.subarray(a, b); });
    }
  });

  return { from: m.dates[0], to: m.asOf, sessions: m.dates.length, stats: run(u, opts) };
}
