import { useEffect, useState } from 'react';
import { NumInput } from './NumInput';
import { Explain } from './Help';
import { runClientBacktest, sizeFor } from './backtestClient';
import { HOSTED, describeFilters, fmtDate, fmtPct, type Filters } from './data';

interface Stats {
  n: number;
  days: number;
  mean: number;
  median: number;
  win: number;
  base: number;
  excess: number;
  beat: number;
  p10: number;
  p90: number;
  t: number | null;
  quarters: { q: string; n: number; excess: number }[];
  // custom runs only
  profitFactor?: number | null;
  held?: number;
  stopped?: number;
  targeted?: number;
  matching?: number;
}
interface Run {
  id: number;
  filters: Filters;
  hold: number;
  stop: number | null;
  target: number | null;
  cost: number;
  stats: Stats | null;
}

const RUNS_KEY = 'nse-screener.runs';
const loadRuns = (): Run[] => {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? '[]');
  } catch {
    return [];
  }
};

function exitText(r: Run) {
  const parts = [`${r.hold} sessions`];
  if (r.stop != null) parts.push(`stop −${r.stop}%`);
  if (r.target != null) parts.push(`target +${r.target}%`);
  parts.push(r.cost ? `${r.cost}% costs` : 'no costs');
  return parts.join(' · ');
}

function Custom({ filters, onOpenFilters }: { filters: Filters; onOpenFilters: (f: Filters) => void }) {
  const [runs, setRuns] = useState<Run[]>(loadRuns);
  const [hold, setHold] = useState<number | null>(10);
  const [stop, setStop] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(0.3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const exits = stop != null || target != null;
  useEffect(() => {
    if (IN_BROWSER) sizeFor(filters, exits).then(setSize);
  }, [filters, exits, runs.length]);

  const criteria = describeFilters({ ...filters, q: '' });
  const testable = filters.flags.length + Object.keys(filters.ranges).length > 0;
  const noFloor = testable && filters.ranges.avgTurnover?.[0] == null;

  const save = (next: Run[]) => {
    setRuns(next);
    localStorage.setItem(RUNS_KEY, JSON.stringify(next));
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    const params = { hold: hold ?? 10, stop, target, cost: cost ?? 0 };
    try {
      let body: { stats: Stats | null };
      if (IN_BROWSER) {
        // hosted: the same engine, run here on history downloaded from the site
        body = (await runClientBacktest({ filters, ...params })) as { stats: Stats | null };
      } else {
        const res = await fetch('/api/backtest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filters, ...params }) });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) throw new Error(json?.error ?? 'Custom backtests need the dev server (npm run dev).');
        body = json;
      }
      save([{ id: Date.now(), filters: { ...filters, q: '' }, ...params, stats: body.stats }, ...runs].slice(0, 30));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="custom">
      <h2>Test a screen</h2>
      <div className="custom-form">
        <div className="custom-criteria">
          <span className="lbl">Buy when a stock first matches</span>
          {testable ? (
            <div className="chips">
              {criteria.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          ) : (
            <p className="muted">Nothing to test yet. Pick a screen or set criteria in the Screener tab, then come back.</p>
          )}
        </div>
        <label>
          <span className="lbl">Sell after</span>
          <span className="unit"><NumInput label="Holding period in sessions" placeholder="10" value={hold} onChange={setHold} /> sessions</span>
        </label>
        <label>
          <span className="lbl">Stop-loss</span>
          <span className="unit"><NumInput label="Stop-loss percent" placeholder="none" value={stop} onChange={setStop} /> %</span>
        </label>
        <label>
          <span className="lbl">Profit target</span>
          <span className="unit"><NumInput label="Profit target percent" placeholder="none" value={target} onChange={setTarget} /> %</span>
        </label>
        <label title="Brokerage, STT, stamp duty and slippage for buying and selling, as a percentage of the trade">
          <span className="lbl">Costs per trade</span>
          <span className="unit"><NumInput label="Round-trip costs percent" placeholder="0" value={cost} onChange={setCost} /> %</span>
        </label>
        <button className="primary" onClick={go} disabled={!testable || busy}>
          {busy ? 'Running…' : 'Run backtest'}
        </button>
      </div>
      {IN_BROWSER && testable && size != null && size > 0 && <p className="note">Running this downloads about {size} MB of price history to your device (once a day; less on later runs).</p>}
      {busy && runs.length === 0 && <p className="note">The first run loads three years of history and takes a few seconds.</p>}
      {(['prom', 'promChg', 'pledge'] as const).some((k) => filters.ranges[k]) && <p className="note down">The ownership filters (promoter holding, its change, pledged shares) can't be backtested, because Sensa has no day-by-day history of them. This test ignores them.</p>}
      {(['revYoY', 'patYoY', 'opm', 'roe', 'de'] as const).some((k) => filters.ranges[k]) && <p className="note">This screen uses figures from quarterly results. Those go back to early 2024, and growth and return on equity need a year of them first, so the test covers roughly the last 18 months rather than three years.</p>}
      {noFloor && <p className="note">This screen has no minimum turnover, so it includes illiquid stocks you may not be able to trade at these prices.</p>}
      {error && <p className="note down">{error}</p>}

      {runs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sym">Screen and exit</th>
                <th title="First-day matches with a completed trade">Signals</th>
                <th title="Average return per trade after costs">Avg return</th>
                <th title="Average liquid stock bought the same day and held for the same number of sessions, before costs">Market</th>
                <th title="Average return minus the market's">Excess</th>
                <th title="Share of trades that made money after costs">Win rate</th>
                <th title="Half the trades did worse than this">Median</th>
                <th title="Total gains divided by total losses. Above 1 means the trades made money overall.">Profit factor</th>
                <th title="Share of trades closed by the stop-loss / by the profit target">Stop / target</th>
                <th title="Average sessions held">Held</th>
                <th className="verdict">Verdict</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const x = r.stats;
                const v = x ? verdict(x) : { text: 'No signals', cls: 'muted' };
                return (
                  <tr key={r.id} onClick={() => onOpenFilters(r.filters)} title="Click to open this screen in the Screener">
                    <td className="sym wrap">
                      <b>{describeFilters(r.filters).join(' · ')}</b>
                      <small>{exitText(r)}{x?.matching != null && ` · ${x.matching} matching today`}</small>
                    </td>
                    {x ? (
                      <>
                        <td>{x.n.toLocaleString('en-IN')}</td>
                        <td className={tone(x.mean)}>{fmtPct(x.mean, 2)}</td>
                        <td>{fmtPct(x.base, 2)}</td>
                        <td className={tone(x.excess)}><b>{fmtPct(x.excess, 2)}</b></td>
                        <td>{x.win.toFixed(0)}%</td>
                        <td className={tone(x.median)}>{fmtPct(x.median, 2)}</td>
                        <td>{x.profitFactor?.toFixed(2) ?? '–'}</td>
                        <td>{r.stop == null && r.target == null ? '–' : `${x.stopped?.toFixed(0)}% / ${x.targeted?.toFixed(0)}%`}</td>
                        <td>{x.held?.toFixed(1)}</td>
                      </>
                    ) : (
                      <td colSpan={9} className="muted" style={{ textAlign: 'left' }}>No stock matched this screen in the period.</td>
                    )}
                    <td className={`verdict ${v.cls}`}>{v.text}</td>
                    <td>
                      <button className="icon" aria-label="Remove run" onClick={(e) => { e.stopPropagation(); save(runs.filter((y) => y.id !== r.id)); }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
interface Result {
  generatedAt: string;
  from: number;
  to: number;
  sessions: number;
  symbols: number;
  horizons: number[];
  setups: { id: string; label: string; blurb: string; h: Record<string, Stats | null> }[];
}

// The hosted site has no server to run backtests on, so they run in the browser.
// Add ?clientbt to the local app's address to try that path there.
const IN_BROWSER = HOSTED || new URLSearchParams(location.search).has('clientbt');

const MIN_SIGNALS = 200;

function verdict(x: Stats): { text: string; cls: string } {
  if (x.n < MIN_SIGNALS || x.t == null) return { text: 'Too few signals', cls: 'muted' };
  if (x.t >= 2 && x.excess > 0) return { text: 'Beat the market', cls: 'up' };
  if (x.t <= -2 && x.excess < 0) return { text: 'Lagged the market', cls: 'down' };
  return { text: 'No clear edge', cls: 'muted' };
}

const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function Backtest({ filters, onOpenPreset: onOpen, onOpenFilters }: {
  filters: Filters;
  onOpenPreset: (presetId: string) => void;
  onOpenFilters: (f: Filters) => void;
}) {
  const [data, setData] = useState<Result | null>(null);
  const [missing, setMissing] = useState(false);
  const [horizon, setHorizon] = useState(10);

  useEffect(() => {
    fetch(`/data/backtest.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setMissing(true));
  }, []);

  const custom = <Custom filters={filters} onOpenFilters={onOpenFilters} />;
  if (missing) {
    return (
      <div className="bt">
        {custom}
        <p className="note">The preset comparison hasn't been generated yet: <code>npm run backtest</code></p>
      </div>
    );
  }
  if (!data) return <div className="bt">{custom}</div>;

  const quarters = [...new Set(data.setups.flatMap((s) => s.h[horizon]?.quarters.map((q) => q.q) ?? []))].sort();

  return (
    <div className="bt">
      {custom}
      <div className="bt-head">
        <div>
          <h2>Preset screens, fixed hold, before costs <Explain term="backtest" /></h2>
          <p>
            {fmtDate(data.from)} – {fmtDate(data.to)} · {data.sessions} sessions · {data.symbols.toLocaleString('en-IN')} stocks
          </p>
        </div>
        <div className="seg" role="group" aria-label="Holding period">
          {data.horizons.map((h) => (
            <button key={h} className={h === horizon ? 'on' : ''} onClick={() => setHorizon(h)}>
              {h} sessions
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sym">Screen</th>
              <th title="First-day matches with a completed holding period">Signals</th>
              <th title="Average return, next-day open to the close N sessions after the signal">Avg return</th>
              <th title="Average return of all liquid stocks over the same dates">Market</th>
              <th title="Average return minus the market's">Excess</th>
              <th title="Share of signals that made money">Win rate</th>
              <th title="Share of signals that did better than the market">Beat market</th>
              <th title="Half the signals did worse than this">Median</th>
              <th title="One signal in ten did worse than this">Worst 10%</th>
              <th title="One signal in ten did better than this">Best 10%</th>
              <th className="verdict">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data.setups.map((s) => {
              const x = s.h[horizon];
              if (!x) return null;
              const v = verdict(x);
              return (
                <tr key={s.id} onClick={() => onOpen(s.id)} title={`${s.blurb} Click to open today's matches.`}>
                  <td className="sym">
                    <b>{s.label}</b>
                    <small>{s.blurb}</small>
                  </td>
                  <td>{x.n.toLocaleString('en-IN')}</td>
                  <td className={tone(x.mean)}>{fmtPct(x.mean, 2)}</td>
                  <td>{fmtPct(x.base, 2)}</td>
                  <td className={tone(x.excess)}><b>{fmtPct(x.excess, 2)}</b></td>
                  <td>{x.win.toFixed(0)}%</td>
                  <td>{x.beat.toFixed(0)}%</td>
                  <td className={tone(x.median)}>{fmtPct(x.median, 2)}</td>
                  <td>{fmtPct(x.p10, 1)}</td>
                  <td>{fmtPct(x.p90, 1)}</td>
                  <td className={`verdict ${v.cls}`}>{v.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Excess return by quarter</h3>
      <p className="note">
        A screen that only worked in one or two quarters was probably riding that market, not showing a durable edge.
      </p>
      <div className="table-wrap">
        <table className="quarters">
          <thead>
            <tr>
              <th className="sym">Screen</th>
              {quarters.map((q) => (
                <th key={q}>{q}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.setups.map((s) => {
              const byQ = new Map(s.h[horizon]?.quarters.map((q) => [q.q, q]));
              return (
                <tr key={s.id}>
                  <td className="sym"><b>{s.label}</b></td>
                  {quarters.map((q) => {
                    const c = byQ.get(q);
                    return (
                      <td key={q} title={c ? `${c.n} signals` : 'No signals'}>
                        {c && c.n >= 20 ? <span className={`cell ${tone(c.excess)}`}>{fmtPct(c.excess, 1)}</span> : <span className="muted">–</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="method">
        <h3>How to read this</h3>
        <ul>
          <li>A signal is the first day a stock matches a screen. You buy at the next session's open and sell at the close {horizon} sessions after the signal.</li>
          <li>In "Test a screen", a stop-loss or target closes the trade early when the day's low or high touches it. If both are touched on the same day it counts as the stop. A gap through the level fills at the open.</li>
          <li>"Market" is the average of every stock with ₹1 Cr+ daily turnover over the same dates. Excess is what the screen added on top.</li>
          <li>The verdict needs {MIN_SIGNALS}+ signals and an excess that is consistent across days (t-statistic beyond ±2). Holding periods overlap, so even that overstates the certainty.</li>
          <li>The preset table leaves out brokerage, STT and slippage (roughly 0.2–0.4% per round trip on delivery trades). Nothing here models position sizing.</li>
          <li>Trying many variations until one looks good will find patterns that are only luck. Treat a good result as a candidate to watch going forward, not as proof.</li>
          <li>Only companies listed today are tested, so stocks that were delisted along the way are missing. That flatters every number here, the market column included.</li>
          <li>Splits and bonuses are inferred from price gaps; a missed one shows up as a false loss.</li>
          <li>Past results over a short window say little about the future. Not investment advice.</li>
        </ul>
      </div>
    </div>
  );
}
