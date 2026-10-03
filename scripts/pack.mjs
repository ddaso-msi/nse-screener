// Packs three years of prices and indicators into compact binary files
// (public/data/bt) so the hosted app can run custom backtests in the browser
// with the same engine as the server (scripts/engine-core.mjs).
//
//   node scripts/pack.mjs
//
// Layout: every column is one flat array holding each stock's sessions back to
// back; meta.json says where each stock starts. Prices and indicators are
// 32-bit floats (NaN = not available), exactly as the engine holds them, so a
// browser backtest gives the same answer as a server one. Flags are one bit
// each in a 16-bit mask. The app downloads only the columns a backtest needs.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAGS, METRICS } from './engine-core.mjs';
import { loadUniverse } from './engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/data/bt');

export async function pack({ log = console.log } = {}) {
  const universe = await loadUniverse({ log });
  const symbols = universe.symbols.filter((s) => !s.etf);
  const total = symbols.reduce((n, s) => n + s.n, 0);
  const dateAt = new Map(universe.dates.map((d, i) => [d, i]));
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const save = (name, typed) => writeFile(path.join(OUT, `${name}.bin`), Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength));

  const day = new Uint16Array(total);
  const price = { o: new Float32Array(total), h: new Float32Array(total), l: new Float32Array(total), c: new Float32Array(total) };
  const flags = new Uint16Array(total);
  const metric = Object.fromEntries(METRICS.map((k) => [k, new Float32Array(total)]));

  const meta = { asOf: universe.dates[universe.dates.length - 1], dates: universe.dates, bars: total, flags: FLAGS, metrics: {}, symbols: [] };
  for (const k of METRICS) meta.metrics[k] = { type: 'f32' };

  let at = 0;
  for (const sym of symbols) {
    meta.symbols.push({ s: sym.s, idx: sym.idx, sector: sym.sector, fo: sym.fo ? 1 : 0, n: sym.n });
    for (let t = 0; t < sym.n; t++, at++) {
      day[at] = dateAt.get(sym.date[t]);
      price.o[at] = sym.o[t]; price.h[at] = sym.h[t]; price.l[at] = sym.l[t]; price.c[at] = sym.c[t];
      let bits = 0;
      FLAGS.forEach((f, i) => { if (sym.f[f]?.[t]) bits |= 1 << i; });
      flags[at] = bits;
      for (const k of METRICS) metric[k][at] = sym.m[k][t];
    }
  }

  await save('day', day);
  for (const [k, a] of Object.entries(price)) await save(k, a);
  await save('flags', flags);
  for (const k of METRICS) await save(`m-${k}`, metric[k]);
  await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta));
  log(`Packed ${symbols.length} stocks, ${total.toLocaleString('en-IN')} bars into public/data/bt`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  pack().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
