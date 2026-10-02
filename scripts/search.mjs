// Structured search for screens that beat the market after costs.
//
//   node scripts/search.mjs
//
// Every combination of entry rule x trend filter x liquidity floor x holding
// period x exit is tested on the earlier part of the history (train). Only the
// combinations that look good there are then checked on the most recent year
// (test), which played no part in choosing them. With over a thousand
// combinations some will look good on train by luck alone, so the test-period
// result is the one that counts.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUniverse, run } from './engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLIT = 20251001; // test = signals on or after this date
const COST = 0.3;
const MIN_TRAIN = 300;
const MIN_TEST = 150;

const ENTRIES = {
  'Delivery accumulation': { ranges: { deliv: [60, null], volX: [1.5, null], chg: [0, null] } },
  'Strong delivery day': { ranges: { deliv: [70, null], volX: [2, null], chg: [1, null] } },
  'Delivery on a down day': { ranges: { deliv: [60, null], volX: [1.5, null], chg: [null, 0] } },
  '52W breakout': { flags: ['newHi'] },
  '52W breakout on 2x volume': { flags: ['newHi'], ranges: { volX: [2, null] } },
  '52W breakout with delivery': { flags: ['newHi'], ranges: { deliv: [50, null], volX: [1.5, null] } },
  'Within 5% of 52W high': { ranges: { fromHi: [-5, null] } },
  'Momentum (3M>15%, 6M>25%)': { ranges: { m3: [15, null], m6: [25, null], rsi: [50, 80] } },
  'Pullback below 20 DMA': { ranges: { vs20: [null, 0], rsi: [30, 50], y1: [0, null] } },
  'Oversold (RSI<=30)': { ranges: { rsi: [null, 30] } },
  'Golden cross': { flags: ['golden'] },
  'Volume spike 3x on an up day': { ranges: { volX: [3, null], chg: [2, null] } },
};
const TRENDS = {
  'any trend': {},
  'above 200 DMA': { vs200: [0, null] },
  'above 50 and 200 DMA': { vs50: [0, null], vs200: [0, null] },
};
const LIQUIDITY = [1, 5, 25];
const HOLDS = [5, 10, 20, 40];
const EXITS = [
  { label: 'no stop', stop: null, target: null },
  { label: '10% stop', stop: 10, target: null },
  { label: '7% stop, 15% target', stop: 7, target: 15 },
];

const universe = await loadUniverse({ log: console.log });
console.log('Searching…');
const results = [];
for (const [entry, e] of Object.entries(ENTRIES)) {
  for (const [trend, tr] of Object.entries(TRENDS)) {
    for (const liq of LIQUIDITY) {
      const filters = { flags: e.flags ?? [], ranges: { ...e.ranges, ...tr, avgTurnover: [liq, null] } };
      for (const hold of HOLDS) {
        for (const exit of EXITS) {
          const opts = { filters, hold, stop: exit.stop, target: exit.target, cost: COST };
          const train = run(universe, { ...opts, to: SPLIT - 1 });
          if (!train) continue;
          results.push({ entry, trend, liq, hold, exit: exit.label, opts, train, test: null });
        }
      }
    }
  }
}

const passedTrain = results.filter((r) => r.train.n >= MIN_TRAIN && r.train.excess > 0 && r.train.t >= 2);
for (const r of passedTrain) r.test = run(universe, { ...r.opts, from: SPLIT });
const survivors = passedTrain
  .filter((r) => r.test && r.test.n >= MIN_TEST && r.test.excess > 0 && r.test.t >= 2 && r.test.mean > 0)
  .sort((a, b) => b.test.t - a.test.t);
const heldSign = passedTrain.filter((r) => r.test && r.test.excess > 0).length;

const slim = ({ quarters, ...s }) => s;
await mkdir(path.join(ROOT, 'public/data'), { recursive: true });
await writeFile(
  path.join(ROOT, 'public/data/search.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    split: SPLIT,
    cost: COST,
    tested: results.length,
    passedTrain: passedTrain.length,
    survivors: survivors.length,
    rows: passedTrain.map((r) => ({ ...r, train: slim(r.train), test: r.test && slim(r.test) })),
  }),
);

const row = (r) =>
  `${r.entry} | ${r.trend} | ≥₹${r.liq}Cr | ${r.hold}d | ${r.exit}`.padEnd(92) +
  [r.train.n, r.train.mean, r.train.excess, r.train.t, r.test?.n, r.test?.mean, r.test?.base, r.test?.excess, r.test?.t, r.test?.win, r.test?.profitFactor]
    .map((v) => String(v ?? '-').padStart(8))
    .join('');
const head = 'rule'.padEnd(92) + ['trN', 'trAvg', 'trExc', 'trT', 'teN', 'teAvg', 'teMkt', 'teExc', 'teT', 'teWin', 'tePF'].map((h) => h.padStart(8)).join('');

console.log(`\nTested ${results.length} combinations, costs ${COST}% per trade.`);
console.log(`Passed on train (before ${SPLIT}): ${passedTrain.length}`);
console.log(`Of those, positive excess on test: ${heldSign}; passed the full test bar: ${survivors.length}`);
console.log(`\nSURVIVORS (sorted by test t)\n${head}`);
survivors.slice(0, 40).forEach((r) => console.log(row(r)));

// which entry rules account for the train passes / survivors
const tally = (list) => Object.entries(list.reduce((m, r) => ((m[r.entry] = (m[r.entry] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
console.log('\nTrain passes by entry:', tally(passedTrain));
console.log('Survivors by entry:', tally(survivors));
console.log(`\nTOP 15 ON TRAIN and what they did on test\n${head}`);
[...passedTrain].sort((a, b) => b.train.t - a.train.t).slice(0, 15).forEach((r) => console.log(row(r)));
