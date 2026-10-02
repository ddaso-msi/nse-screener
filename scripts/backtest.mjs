// Replays the app's preset screens over NSE history and measures what the
// matched stocks did next. See scripts/engine.mjs for the trade model.
//
//   node scripts/backtest.mjs            ~3 years of history
//   BACKTEST_DAYS=1800 node scripts/backtest.mjs
//
// Presets are tested with a fixed holding period, no stop or target, and no
// costs. Custom screens with exits are tested from the app's Backtest tab.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOOKBACK, loadUniverse, run } from './engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HORIZONS = [5, 10, 20];

async function main() {
  const log = console.log;
  const universe = await loadUniverse({ log, lookback: Number(process.env.BACKTEST_DAYS ?? DEFAULT_LOOKBACK) });
  const presets = JSON.parse(await readFile(path.join(ROOT, 'src/presets.json'), 'utf8')).filter(
    (p) => p.id !== 'all',
  );

  log('Replaying screens…');
  const setups = presets.map((p) => ({
    id: p.id,
    label: p.label,
    blurb: p.blurb,
    h: Object.fromEntries(HORIZONS.map((hold) => [hold, run(universe, { filters: p.filters, hold })])),
  }));

  const { dates } = universe;
  const result = {
    generatedAt: new Date().toISOString(),
    from: dates[0],
    to: dates[dates.length - 1],
    sessions: dates.length,
    symbols: universe.symbols.length,
    horizons: HORIZONS,
    setups,
  };
  await mkdir(path.join(ROOT, 'public/data'), { recursive: true });
  await writeFile(path.join(ROOT, 'public/data/backtest.json'), JSON.stringify(result));

  log(`\n${dates.length} sessions (${dates[0]} → ${dates[dates.length - 1]}), ${result.symbols} stocks`);
  for (const h of HORIZONS) {
    log(`\n${h}-session hold        signals   avg%  market%  excess%   win%  beat%      t`);
    for (const s of setups) {
      const x = s.h[h];
      if (!x) continue;
      log(
        s.label.padEnd(24) +
          [x.n, x.mean, x.base, x.excess, x.win, x.beat, x.t].map((v) => String(v).padStart(8)).join(''),
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
