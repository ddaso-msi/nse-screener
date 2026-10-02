import { useCallback, useEffect, useState } from 'react';
import { describeFilters, fmtDate, fmtMcap, fmtPct, fmtPrice, EMPTY, type Filters } from './data';
import type { BriefScreen, Watchlist } from './user';

interface Card {
  s: string;
  name: string;
  close: number;
  chg: number | null;
  volX: number | null;
  deliv: number | null;
  rsi: number | null;
  vs50: number | null;
  vs200: number | null;
  fromHi: number | null;
  hi52: number;
  low10: number | null;
  mcap: number | null;
  pe: number | null;
  nextEx: { ex: number; text: string } | null;
}
interface Alert { kind: 'up' | 'down' | 'info'; text: string; ex?: number }
interface WatchRow extends Partial<Card> {
  s: string;
  note: string;
  level: number | null;
  toLevel?: number | null;
  added?: number | null;
  sinceAdded?: number | null;
  missing?: boolean;
  alerts: Alert[];
}
interface Outcome { n: number; avg: number; market: number; win: number }
interface LogEntry {
  id: string;
  date: number;
  label: string;
  s: string;
  close?: number;
  entry?: number;
  last?: number | null;
  r5?: number; r10?: number; r20?: number;
  m5?: number; m10?: number; m20?: number;
}
interface BriefData {
  asOf: number;
  generatedAt: string;
  screens: { id: string; label: string; filters: BriefScreen['filters']; total: number; fresh: Card[]; dropped: string[] }[];
  watchlist: WatchRow[];
  scoreboard: { id: string; label: string; logged: number; h5: Outcome | null; h10: Outcome | null; h20: Outcome | null }[];
  log: LogEntry[];
  logTotal: number;
}

const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down');
const x1 = (v: number | null | undefined, suffix = '') => (v == null ? '–' : `${v.toFixed(1)}${suffix}`);
const alertText = (a: Alert) => (a.ex ? a.text.replace(String(a.ex), fmtDate(a.ex)) : a.text);

export function Brief({ watchlist, onToggleWatch, screens, onSaveScreens, current, onOpenStock, onOpenFilters }: {
  watchlist: Watchlist;
  onToggleWatch: (s: string) => void;
  screens: BriefScreen[];
  onSaveScreens: (next: BriefScreen[] | ((prev: BriefScreen[]) => BriefScreen[])) => void;
  current: Filters;
  onOpenStock: (s: string) => void;
  onOpenFilters: (f: Partial<Filters>) => void;
}) {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/data/brief.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => {
        setBrief(b);
        setMissing(false);
      })
      .catch(() => setMissing(true));
  }, []);
  useEffect(load, [load]);

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      // give a just-edited watchlist or screen list time to reach disk
      await new Promise((r) => setTimeout(r, 600));
      const res = await fetch('/api/brief', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error ?? 'Updating the brief needs the dev server (npm run dev), or run npm run brief.');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const currentCriteria = current.flags.length + Object.keys(current.ranges).length;
  const addCurrent = () => {
    const label = window.prompt('Name this screen for the brief')?.trim();
    if (!label) return;
    const id = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    onSaveScreens([...screens, { id, label, filters: { ...current, q: '' } }]);
  };

  if (missing) {
    return (
      <div className="bt brief empty-app">
        <p>No brief has been built yet.</p>
        <button className="primary" onClick={rebuild} disabled={busy}>{busy ? 'Building…' : 'Build the brief'}</button>
        {error && <p className="note down">{error}</p>}
      </div>
    );
  }
  if (!brief) return <div className="bt brief" />;

  const inBrief = new Set(brief.watchlist.map((w) => w.s));
  const watchKeys = Object.keys(watchlist);
  const notesDiffer = brief.watchlist.some((w) => watchlist[w.s] && ((watchlist[w.s].note ?? '') !== w.note || (watchlist[w.s].level ?? null) !== w.level));
  const screensDiffer = screens.length > 0 && screens.map((s) => s.id).join() !== brief.screens.map((s) => s.id).join();
  const stale = watchKeys.length !== inBrief.size || watchKeys.some((s) => !inBrief.has(s)) || notesDiffer || screensDiffer;
  const withAlerts = brief.watchlist.filter((w) => w.alerts.length > 0).length;
  const totalNew = brief.screens.reduce((n, s) => n + s.fresh.length, 0);

  const star = (s: string) => (
    <button
      className={`star ${watchlist[s] ? 'on' : ''}`}
      aria-label={watchlist[s] ? `Remove ${s} from watchlist` : `Add ${s} to watchlist`}
      aria-pressed={!!watchlist[s]}
      onClick={(e) => { e.stopPropagation(); onToggleWatch(s); }}
    >
      {watchlist[s] ? '★' : '☆'}
    </button>
  );

  return (
    <div className="bt brief">
      <div className="bt-head">
        <div>
          <h2>Evening brief · {fmtDate(brief.asOf)}</h2>
          <p>
            {totalNew} new {totalNew === 1 ? 'match' : 'matches'} across {brief.screens.length} screens · {withAlerts} of {brief.watchlist.length} watchlist stocks with something to note
          </p>
        </div>
        <div className="brief-actions">
          {stale && <span className="muted">Your watchlist or screens changed.</span>}
          <button onClick={rebuild} disabled={busy} className={stale ? 'primary' : ''}>{busy ? 'Updating…' : 'Update brief'}</button>
        </div>
      </div>
      {error && <p className="note down">{error}</p>}

      <h3>Watchlist</h3>
      {brief.watchlist.length === 0 ? (
        <p className="note">Nothing on your watchlist yet. Click the ☆ next to any stock here or in the Screener, then set a note and an alert level from its detail panel.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sym">Stock</th>
                <th>Price</th>
                <th>Day</th>
                <th title="Change since the session you added it">Since added</th>
                <th title="Your alert level and how far the price is from it">Your level</th>
                <th className="left">Today</th>
                <th className="left">Your note</th>
              </tr>
            </thead>
            <tbody>
              {brief.watchlist.map((w) => (
                <tr key={w.s} onClick={() => onOpenStock(w.s)}>
                  <td className="sym">{star(w.s)}<b>{w.s}</b><small>{w.name ?? 'Not traded in the latest session'}</small></td>
                  <td>{fmtPrice(w.close)}</td>
                  <td className={tone(w.chg)}>{fmtPct(w.chg, 2)}</td>
                  <td className={tone(w.sinceAdded)}>{fmtPct(w.sinceAdded)}</td>
                  <td>{w.level == null ? '–' : <>₹{fmtPrice(w.level)} <small className="muted">{fmtPct(w.toLevel)} away</small></>}</td>
                  <td className="left wrap">
                    {w.alerts.length === 0 ? <span className="muted">Nothing notable</span> : w.alerts.map((a) => (
                      <span key={a.text} className={`alert ${a.kind}`}>{a.kind === 'up' ? '▲' : a.kind === 'down' ? '▼' : '•'} {alertText(a)}</span>
                    ))}
                  </td>
                  <td className="left wrap muted">{w.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {brief.screens.map((sc) => (
        <section key={sc.id}>
          <div className="screen-head">
            <h3>{sc.label} <small>{sc.fresh.length} new today · {sc.total} matching in all</small></h3>
            <div>
              <button className="link" onClick={() => onOpenFilters({ ...EMPTY, ...sc.filters })}>Open in Screener</button>
              <button className="link" onClick={() => onSaveScreens((screens.length ? screens : brief.screens).filter((x) => x.id !== sc.id).map(({ id, label, filters }) => ({ id, label, filters })))}>Remove from brief</button>
            </div>
          </div>
          <p className="note">{describeFilters({ ...EMPTY, ...sc.filters }).join(' · ')}</p>
          {sc.fresh.length === 0 ? (
            <p className="note">No new matches today.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="sym">Stock</th>
                    <th>Price</th>
                    <th>Day</th>
                    <th title="Volume vs 20-session average">Vol ×</th>
                    <th title="Delivery percentage">Deliv</th>
                    <th>RSI</th>
                    <th title="Price vs 50-day average">vs 50D</th>
                    <th title="Price vs 200-day average">vs 200D</th>
                    <th title="52-week high and distance from it">52W high</th>
                    <th title="Lowest low of the last 10 sessions, a common place for a stop">10-day low</th>
                    <th>M.Cap</th>
                    <th>P/E</th>
                  </tr>
                </thead>
                <tbody>
                  {sc.fresh.map((c) => (
                    <tr key={c.s} onClick={() => onOpenStock(c.s)}>
                      <td className="sym">
                        {star(c.s)}<b>{c.s}</b>
                        {c.nextEx && <mark className="ex" title={`${c.nextEx.text}, ex-date ${fmtDate(c.nextEx.ex)}`}>EX {fmtDate(c.nextEx.ex, false)}</mark>}
                        <small>{c.name}</small>
                      </td>
                      <td>{fmtPrice(c.close)}</td>
                      <td className={tone(c.chg)}>{fmtPct(c.chg, 2)}</td>
                      <td>{x1(c.volX, '×')}</td>
                      <td>{c.deliv == null ? '–' : `${c.deliv.toFixed(0)}%`}</td>
                      <td>{c.rsi == null ? '–' : c.rsi.toFixed(0)}</td>
                      <td className={tone(c.vs50)}>{fmtPct(c.vs50)}</td>
                      <td className={tone(c.vs200)}>{fmtPct(c.vs200)}</td>
                      <td>{fmtPrice(c.hi52)} <small className="muted">{fmtPct(c.fromHi)}</small></td>
                      <td>{fmtPrice(c.low10)} <small className="muted">{c.low10 ? fmtPct((c.low10 / c.close - 1) * 100) : ''}</small></td>
                      <td>{fmtMcap(c.mcap)}</td>
                      <td>{c.pe == null ? '–' : c.pe.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sc.dropped.length > 0 && (
            <p className="note dropped">
              No longer matching ({sc.dropped.length}):{' '}
              {sc.dropped.slice(0, 40).map((s) => (
                <button key={s} className="link" onClick={() => onOpenStock(s)}>{s}</button>
              ))}
              {sc.dropped.length > 40 && ` and ${sc.dropped.length - 40} more`}
            </p>
          )}
        </section>
      ))}
      <p className="note">
        <button className="link first" onClick={addCurrent} disabled={currentCriteria === 0}>
          + Add the criteria currently set in the Screener to the brief
        </button>
        {currentCriteria === 0 && ' (set some criteria in the Screener first)'}
      </p>

      <h3>Forward log <small>{brief.logTotal} matches recorded since {brief.log.length ? fmtDate(brief.log[brief.log.length - 1].date) : '–'}</small></h3>
      <p className="note">
        Every new match is recorded on the day it happens, then scored: bought at the next open, compared with the average liquid stock over the same sessions. Results appear once 5, 10 and 20 sessions have passed.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sym">Screen</th>
              <th>Logged</th>
              {[5, 10, 20].map((h) => (
                <th key={h} colSpan={3} className="group">After {h} sessions</th>
              ))}
            </tr>
            <tr className="sub">
              <th className="sym" />
              <th />
              {[5, 10, 20].flatMap((h) => [<th key={`a${h}`}>Avg</th>, <th key={`m${h}`}>Market</th>, <th key={`w${h}`}>Win rate</th>])}
            </tr>
          </thead>
          <tbody>
            {brief.scoreboard.map((sb) => (
              <tr key={sb.id} className="static">
                <td className="sym"><b>{sb.label}</b></td>
                <td>{sb.logged}</td>
                {([sb.h5, sb.h10, sb.h20] as (Outcome | null)[]).flatMap((o, i) =>
                  o
                    ? [
                        <td key={`a${i}`} className={tone(o.avg)} title={`${o.n} completed`}>{fmtPct(o.avg, 2)}</td>,
                        <td key={`m${i}`}>{fmtPct(o.market, 2)}</td>,
                        <td key={`w${i}`}>{o.win.toFixed(0)}%</td>,
                      ]
                    : [<td key={`a${i}`} colSpan={3} className="muted center">not yet</td>],
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details>
        <summary>Recent entries ({Math.min(brief.log.length, 400)})</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sym">Stock</th>
                <th className="left">Screen</th>
                <th>Matched</th>
                <th title="Close on the day it matched">Close</th>
                <th title="Next session's open">Entry</th>
                <th title="Entry to the latest close">To date</th>
                <th>5</th>
                <th>10</th>
                <th>20</th>
              </tr>
            </thead>
            <tbody>
              {brief.log.map((e) => (
                <tr key={e.id} onClick={() => onOpenStock(e.s)}>
                  <td className="sym">{star(e.s)}<b>{e.s}</b></td>
                  <td className="left">{e.label}</td>
                  <td>{fmtDate(e.date)}</td>
                  <td>{fmtPrice(e.close)}</td>
                  <td>{e.entry == null ? <span className="muted">next open</span> : fmtPrice(e.entry)}</td>
                  <td className={tone(e.entry == null ? null : e.last)}>{e.entry == null ? '–' : fmtPct(e.last)}</td>
                  <td className={tone(e.r5)}>{fmtPct(e.r5)}</td>
                  <td className={tone(e.r10)}>{fmtPct(e.r10)}</td>
                  <td className={tone(e.r20)}>{fmtPct(e.r20)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="note">These are stocks that matched rules, not recommendations. The backtests found no rule here that reliably beats the market after costs.</p>
    </div>
  );
}
