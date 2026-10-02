import { useCallback, useEffect, useState } from 'react';
import { BUILD_LABEL, HOSTED, describeFilters, fmtDate, fmtMcap, fmtPct, fmtPrice, EMPTY, type Filters, type Row } from './data';
import { BreadthMeter, Market, type MarketData } from './Market';
import { Delta, Icon, Meter, Spark, tone } from './ui';
import type { BriefScreen, Watchlist } from './user';

interface Card {
  s: string;
  name: string;
  close: number;
  chg: number | null;
  volX: number | null;
  deliv: number | null;
  rsi: number | null;
  rs?: number | null;
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
  market?: MarketData;
  screens: { id: string; label: string; filters: BriefScreen['filters']; total: number; fresh: Card[]; dropped: string[] }[];
  scoreboard: { id: string; label: string; logged: number; h5: Outcome | null; h10: Outcome | null; h20: Outcome | null }[];
  log: LogEntry[];
  logTotal: number;
}

const x1 = (v: number | null | undefined, suffix = '') => (v == null ? '–' : `${v.toFixed(1)}${suffix}`);
const alertText = (a: Alert) => (a.ex ? a.text.replace(String(a.ex), fmtDate(a.ex)) : a.text);

/**
 * What is worth noting today about each watched stock. Worked out here, from
 * the same data as the Screener, so every user gets their own without the
 * evening job knowing who they are.
 */
function watchRows(watchlist: Watchlist, rowOf: Map<string, Row>, brief: BriefData): WatchRow[] {
  const matched = new Map<string, string[]>();
  for (const sc of brief.screens) for (const c of sc.fresh) (matched.get(c.s) ?? matched.set(c.s, []).get(c.s)!).push(sc.label);
  const rows = Object.entries(watchlist).map(([s, item]): WatchRow => {
    const r = rowOf.get(s);
    if (!r) return { s, note: item.note ?? '', level: item.level ?? null, missing: true, alerts: [] };
    const alerts: Alert[] = [];
    const level = item.level;
    const prev = r.chg != null ? r.close / (1 + r.chg / 100) : r.close;
    if (level && level > 0) {
      if (prev < level && r.close >= level) alerts.push({ kind: 'up', text: `Closed above your level of ₹${level}` });
      else if (prev > level && r.close <= level) alerts.push({ kind: 'down', text: `Closed below your level of ₹${level}` });
    }
    if (r.newHi) alerts.push({ kind: 'up', text: 'New 52-week high' });
    if (r.newLo) alerts.push({ kind: 'down', text: 'New 52-week low' });
    if (r.cross === 1) alerts.push({ kind: 'up', text: 'Golden cross in the last 10 sessions' });
    if (r.cross === -1) alerts.push({ kind: 'down', text: 'Death cross in the last 10 sessions' });
    if (Math.abs(r.chg ?? 0) >= 4) alerts.push({ kind: r.chg! > 0 ? 'up' : 'down', text: `Moved ${r.chg! > 0 ? '+' : '−'}${Math.abs(r.chg!).toFixed(1)}% today` });
    if ((r.volX ?? 0) >= 2) alerts.push({ kind: 'info', text: `Volume ${r.volX!.toFixed(1)}× its 20-day average` });
    for (const label of matched.get(s) ?? []) alerts.push({ kind: 'info', text: `Newly matched "${label}"` });
    if (r.bm) alerts.push({ kind: 'info', text: `Board meeting on ${fmtDate(r.bm.date)}: ${r.bm.purpose}` });
    for (const subject of r.filed ?? []) alerts.push({ kind: 'info', text: `Filed today: ${subject}` });
    if (r.build) alerts.push({ kind: r.build === 'LB' || r.build === 'SC' ? 'up' : 'down', text: `${BUILD_LABEL[r.build]} in futures (open interest ${fmtPct(r.foOiChg)})` });
    if (r.ban) alerts.push({ kind: 'down', text: 'In the F&O ban period' });
    if (r.pat?.length) alerts.push({ kind: 'info', text: `Chart pattern: ${r.pat.length} detected` });
    if (r.nextEx) alerts.push({ kind: 'info', text: `${r.nextEx.text}, ex-date ${fmtDate(r.nextEx.ex)}` });
    return {
      s, name: r.name, close: r.close, chg: r.chg,
      note: item.note ?? '',
      level: level ?? null,
      toLevel: level && level > 0 ? (level / r.close - 1) * 100 : null,
      added: item.added ?? null,
      sinceAdded: item.price ? (r.close / item.price - 1) * 100 : null,
      alerts,
    };
  });
  return rows.sort((a, b) => b.alerts.length - a.alerts.length || a.s.localeCompare(b.s));
}

const PREVIEW = 8; // rows shown per screen before "Show all"

function weekday(key: number) {
  return new Date(Math.floor(key / 10000), (Math.floor(key / 100) % 100) - 1, key % 100).toLocaleDateString('en-IN', { weekday: 'long' });
}

export function Brief({ watchlist, onToggleWatch, screens, onSaveScreens, current, onOpenStock, onOpenFilters, rowOf, onGoScreener, onRebuilt, canEditScreens }: {
  rowOf: Map<string, Row>;
  onGoScreener: () => void;
  onRebuilt?: () => void;
  /** Whether this user may change which screens the (shared) brief follows */
  canEditScreens: boolean;
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
      onRebuilt?.();
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

  const watch = watchRows(watchlist, rowOf, brief);
  const stale = screens.length > 0 && screens.map((s) => s.id).join() !== brief.screens.map((s) => s.id).join();
  const withAlerts = watch.filter((w) => w.alerts.length > 0).length;
  const totalNew = brief.screens.reduce((n, s) => n + s.fresh.length, 0);
  const m = brief.market;

  const moved = m ? m.advancers + m.decliners : 0;
  const fell = moved ? m!.decliners / moved : 0.5;
  const headline = !m ? 'Your evening brief' : fell >= 0.6 ? 'Most stocks fell today.' : fell <= 0.4 ? 'Most stocks rose today.' : 'A mixed day for the market.';
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
      <header className="hero">
        <div className="hero-text">
          <p className="eyebrow">Evening brief · {weekday(brief.asOf)}, {fmtDate(brief.asOf)}</p>
          <h2>{headline}</h2>
          {m && (
            <p className="lede">
              {m.decliners.toLocaleString('en-IN')} of {m.liquid.toLocaleString('en-IN')} liquid stocks declined and the median stock moved{' '}
              <b className={tone(m.medianChg)}>{fmtPct(m.medianChg, 2)}</b>. There were {m.newHi} new 52-week highs against {m.newLo} new lows.
            </p>
          )}
          <div className="hero-chips">
            <button onClick={() => jump('watchlist')}>
              <b>{withAlerts}</b> watchlist {withAlerts === 1 ? 'alert' : 'alerts'}
            </button>
            <button onClick={() => jump(`screen-${brief.screens[0]?.id}`)}>
              <b>{totalNew}</b> new screen {totalNew === 1 ? 'match' : 'matches'}
            </button>
            <button onClick={() => jump('log')}>
              <b>{brief.logTotal}</b> in the forward log
            </button>
          </div>
        </div>
        {m && <BreadthMeter market={m} />}
      </header>

      <nav className="subnav" aria-label="Brief sections">
        {m && <button onClick={() => jump('market')}>Market</button>}
        <button onClick={() => jump('watchlist')}>Watchlist <em>{watch.length}</em></button>
        {brief.screens.map((sc) => (
          <button key={sc.id} onClick={() => jump(`screen-${sc.id}`)}>{sc.label} <em>{sc.fresh.length}</em></button>
        ))}
        <button onClick={() => jump('log')}>Forward log</button>
        <span className="subnav-right">
          {stale && <span className="muted">The screens changed.{HOSTED && ' The brief picks this up on its next evening run.'}</span>}
          {!HOSTED && (
            <button className={stale ? 'primary' : 'plain'} onClick={rebuild} disabled={busy}>
              <span className={busy ? 'spin' : ''}><Icon name="refresh" /></span> {busy ? 'Updating…' : 'Update brief'}
            </button>
          )}
        </span>
      </nav>
      {error && <p className="note down">{error}</p>}

      {m && <Market market={m} />}

      <section id="watchlist">
        <h3>Watchlist <small>{withAlerts} of {watch.length} with something to note</small></h3>
        {watch.length === 0 ? (
          <div className="empty-card">
            <span className="big-star">★</span>
            <div>
              <b>Start a watchlist</b>
              <p>Star any stock to follow it here. Add a note and a price level from its panel, and the brief will tell you when it crosses the level, hits a 52-week high or low, or has an ex-date coming.</p>
            </div>
            <button className="primary" onClick={onGoScreener}>Find stocks <Icon name="arrowRight" /></button>
          </div>
        ) : (
          <div className="cards">
            {watch.map((w) => (
              <article key={w.s} className={`card ${w.alerts.length ? 'has-alerts' : ''}`} onClick={() => onOpenStock(w.s)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpenStock(w.s)}>
                <header>
                  <div>
                    {star(w.s)}<b>{w.s}</b>
                    <small>{w.name ?? 'Not traded in the latest session'}</small>
                  </div>
                  <Spark data={rowOf.get(w.s)?.spark} width={84} height={30} />
                </header>
                <div className="card-price">
                  <strong>{w.close == null ? '–' : `₹${fmtPrice(w.close)}`}</strong>
                  <Delta value={w.chg} />
                  {w.sinceAdded != null && <span className="muted">{fmtPct(w.sinceAdded)} since added</span>}
                </div>
                {w.level != null && (
                  <p className="card-level">
                    Your level ₹{fmtPrice(w.level)} <span className="muted">· price is {fmtPct(w.toLevel == null ? null : -w.toLevel)} from it</span>
                  </p>
                )}
                <ul className="card-alerts">
                  {w.alerts.length === 0 && <li className="muted">Nothing notable today</li>}
                  {w.alerts.map((a) => (
                    <li key={a.text} className={a.kind}><i>{a.kind === 'up' ? '▲' : a.kind === 'down' ? '▼' : '•'}</i>{alertText(a)}</li>
                  ))}
                </ul>
                {w.note && <blockquote>{w.note}</blockquote>}
              </article>
            ))}
          </div>
        )}
      </section>

      {brief.screens.map((sc) => {
        const all = expanded[sc.id];
        const shown = all ? sc.fresh : sc.fresh.slice(0, PREVIEW);
        return (
          <section key={sc.id} id={`screen-${sc.id}`}>
            <div className="screen-head">
              <h3>{sc.label} <small>{sc.fresh.length} new today · {sc.total} matching in all</small></h3>
              <div>
                <button className="link" onClick={() => onOpenFilters({ ...EMPTY, ...sc.filters })}>Open in Screener</button>
                {canEditScreens && <button className="link" onClick={() => onSaveScreens((screens.length ? screens : brief.screens).filter((x) => x.id !== sc.id).map(({ id, label, filters }) => ({ id, label, filters })))}>Remove from brief</button>}
              </div>
            </div>
            <div className="criteria">
              {describeFilters({ ...EMPTY, ...sc.filters }).map((c) => <span key={c}>{c}</span>)}
            </div>
            {sc.fresh.length === 0 ? (
              <p className="note">No new matches today.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sym">Stock</th>
                      <th className="sparkcol">3M trend</th>
                      <th>Price</th>
                      <th>Day</th>
                      <th title="Volume vs 20-session average">Vol ×</th>
                      <th title="Delivery percentage">Deliv</th>
                      <th title="Relative strength, 1–99">RS</th>
                      <th title="Price vs 50-day average">vs 50D</th>
                      <th title="Price vs 200-day average">vs 200D</th>
                      <th title="Distance from the 52-week high">From 52W high</th>
                      <th title="Lowest low of the last 10 sessions, a common place for a stop">10-day low</th>
                      <th>M.Cap</th>
                      <th>P/E</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.s} onClick={() => onOpenStock(c.s)}>
                        <td className="sym">
                          {star(c.s)}<b>{c.s}</b>
                          {c.nextEx && <mark className="ex" title={`${c.nextEx.text}, ex-date ${fmtDate(c.nextEx.ex)}`}>EX {fmtDate(c.nextEx.ex, false)}</mark>}
                          <small>{c.name}</small>
                        </td>
                        <td className="sparkcol"><Spark data={rowOf.get(c.s)?.spark} /></td>
                        <td>{fmtPrice(c.close)}</td>
                        <td><Delta value={c.chg} /></td>
                        <td>{x1(c.volX, '×')}</td>
                        <td>{c.deliv == null ? '–' : `${c.deliv.toFixed(0)}%`}</td>
                        <td><Meter value={c.rs} /></td>
                        <td className={tone(c.vs50)}>{fmtPct(c.vs50)}</td>
                        <td className={tone(c.vs200)}>{fmtPct(c.vs200)}</td>
                        <td>{fmtPct(c.fromHi)}</td>
                        <td>{fmtPrice(c.low10)} <small className="muted">{c.low10 ? fmtPct((c.low10 / c.close - 1) * 100) : ''}</small></td>
                        <td>{fmtMcap(c.mcap)}</td>
                        <td>{c.pe == null ? '–' : c.pe.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sc.fresh.length > PREVIEW && (
                  <button className="more" onClick={() => setExpanded((e) => ({ ...e, [sc.id]: !all }))}>
                    {all ? 'Show fewer' : `Show all ${sc.fresh.length}`}
                  </button>
                )}
              </div>
            )}
            {sc.dropped.length > 0 && (
              <details className="dropped">
                <summary>{sc.dropped.length} no longer matching</summary>
                <p>
                  {sc.dropped.map((s) => (
                    <button key={s} className="link" onClick={() => onOpenStock(s)}>{s}</button>
                  ))}
                </p>
              </details>
            )}
          </section>
        );
      })}
      {canEditScreens && <button className="add-screen" onClick={addCurrent} disabled={currentCriteria === 0} title={currentCriteria === 0 ? 'Set some criteria in the Screener first' : undefined}>
        + Follow another screen
        <small>{currentCriteria === 0 ? 'Set criteria in the Screener, then add them here' : 'Adds the criteria currently set in the Screener'}</small>
      </button>}

      <section id="log">
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
                      : [<td key={`a${i}`} colSpan={3} className="muted center">waiting for {[5, 10, 20][i]} sessions</td>],
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
      </section>
      <p className="note disclaimer">These are stocks that matched rules, not recommendations. The backtests found no rule here that reliably beats the market after costs.</p>
    </div>
  );
}
