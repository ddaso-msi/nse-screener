import { useCallback, useEffect, useMemo, useState } from 'react';
import { Backtest } from './Backtest';
import { Brief } from './Brief';
import { Detail } from './Detail';
import { NumInput } from './NumInput';
import { useBriefScreens, useWatchlist } from './user';
import {
  EMPTY, FIELD_GROUPS, FLAGS, IDX_LABEL, PRESETS, UNIVERSES,
  HOSTED, applyFilters, describeRange, fmtCr, fmtMcap, fmtDate, fmtPct, fmtPrice, sortRows, toCsv,
  type Dataset, type Filters, type Flag, type NumKey, type Row,
} from './data';

type Sort = [keyof Row, 1 | -1];
interface Saved { name: string; filters: Filters; sort: Sort }

const PAGE = 100;
const SAVED_KEY = 'nse-screener.saved';

const loadSaved = (): Saved[] => {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
  } catch {
    return [];
  }
};

const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down');
const pctCell = (v: number | null) => <span className={tone(v)}>{fmtPct(v)}</span>;

const COLUMNS: { key: keyof Row; label: string; title?: string; cell: (r: Row) => React.ReactNode }[] = [
  { key: 'close', label: 'Price', cell: (r) => fmtPrice(r.close) },
  { key: 'chg', label: 'Day', cell: (r) => <span className={tone(r.chg)}>{fmtPct(r.chg, 2)}</span> },
  { key: 'w1', label: '1W', cell: (r) => pctCell(r.w1) },
  { key: 'm1', label: '1M', cell: (r) => pctCell(r.m1) },
  { key: 'm3', label: '3M', cell: (r) => pctCell(r.m3) },
  { key: 'm6', label: '6M', cell: (r) => pctCell(r.m6) },
  { key: 'y1', label: '1Y', cell: (r) => pctCell(r.y1) },
  { key: 'rs', label: 'RS', title: 'Relative strength, 1–99: share of stocks outperformed over the past year', cell: (r) => (r.rs == null ? '–' : r.rs) },
  { key: 'mcap', label: 'M.Cap', title: 'Market capitalisation, ₹ crore', cell: (r) => fmtMcap(r.mcap) },
  { key: 'pe', label: 'P/E', title: 'NSE trailing P/E', cell: (r) => (r.pe == null ? '–' : r.pe.toFixed(1)) },
  { key: 'rsi', label: 'RSI', title: '14-session RSI', cell: (r) => (r.rsi == null ? '–' : r.rsi.toFixed(0)) },
  { key: 'vs50', label: 'vs 50D', title: 'Price vs 50-day moving average', cell: (r) => pctCell(r.vs50) },
  { key: 'vs200', label: 'vs 200D', title: 'Price vs 200-day moving average', cell: (r) => pctCell(r.vs200) },
  { key: 'fromHi', label: '52W high', title: 'Distance from the 52-week high', cell: (r) => fmtPct(r.fromHi) },
  { key: 'volX', label: 'Vol ×', title: 'Volume vs 20-session average', cell: (r) => (r.volX == null ? '–' : `${r.volX.toFixed(1)}×`) },
  { key: 'deliv', label: 'Deliv', title: 'Delivery percentage', cell: (r) => (r.deliv == null ? '–' : `${r.deliv.toFixed(0)}%`) },
  { key: 'avgTurnover', label: 'Turnover', title: '20-session average daily turnover, ₹ crore', cell: (r) => fmtCr(r.avgTurnover) },
];

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return <svg className="spark" />;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * 62 + 1).toFixed(1)},${(19 - ((v - lo) / (hi - lo || 1)) * 18).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={`spark ${data[data.length - 1] >= data[0] ? 'up' : 'down'}`} viewBox="0 0 64 20" aria-hidden>
      <polyline points={pts} />
    </svg>
  );
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<Sort>(['avgTurnover', -1]);
  const [preset, setPreset] = useState<string | null>('all');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [view, setView] = useState<'brief' | 'screener' | 'backtest'>('brief');
  const [watchlist, saveWatchlist] = useWatchlist();
  const [briefScreens, saveBriefScreens] = useBriefScreens();
  const [watchOnly, setWatchOnly] = useState(false);
  const [briefKey, setBriefKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/data/screener.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('No data yet'))))
      .then(setData)
      .catch((e) => setLoadError(e.message));
  }, []);
  useEffect(load, [load]);

  const refresh = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error ?? 'Refresh needs the dev server (npm run dev), or run npm run sync.');
      setSyncMsg(body.asOf === data?.asOf ? 'Already up to date.' : `Updated to ${fmtDate(body.asOf)}.`);
      load();
      setBriefKey((k) => k + 1);
    } catch (e) {
      setSyncMsg((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const sectors = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.sector).filter((s): s is string => !!s))].sort(),
    [data],
  );
  const rows = useMemo(
    () => (data ? sortRows(applyFilters(watchOnly ? data.rows.filter((r) => watchlist[r.s]) : data.rows, filters), sort[0], sort[1]) : []),
    [data, filters, sort, watchOnly, watchlist],
  );
  const selectedRow = useMemo(() => data?.rows.find((r) => r.s === selected) ?? null, [data, selected]);
  const closeDetail = useCallback(() => setSelected(null), []);

  const toggleWatch = (s: string) => {
    saveWatchlist((prev) => {
      const next = { ...prev };
      if (next[s]) delete next[s];
      else next[s] = { added: data?.asOf ?? 0, note: '', level: null };
      return next;
    });
  };
  const openStock = useCallback((s: string) => {
    setSelected(s);
    setView('screener');
  }, []);

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPreset(null);
    setShown(PAGE);
  };
  const setRange = (key: NumKey, side: 0 | 1, v: number | null) => {
    const cur = filters.ranges[key] ?? [null, null];
    const next: [number | null, number | null] = side === 0 ? [v, cur[1]] : [cur[0], v];
    const ranges = { ...filters.ranges, [key]: next };
    if (next[0] == null && next[1] == null) delete ranges[key];
    update({ ranges });
  };
  const toggleFlag = (flag: Flag) =>
    update({ flags: filters.flags.includes(flag) ? filters.flags.filter((f) => f !== flag) : [...filters.flags, flag] });

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    // presets replace the criteria but keep the chosen universe, sector and search
    setFilters((f) => ({ ...EMPTY, q: f.q, universe: f.universe, sector: f.sector, ...p.filters }));
    setSort(p.sort);
    setPreset(id);
    setWatchOnly(false);
    setShown(PAGE);
  };
  const showWatchlist = () => {
    setFilters(EMPTY);
    setSort(['s', 1]);
    setPreset('watch');
    setWatchOnly(true);
    setShown(PAGE);
  };
  const applySaved = (s: Saved) => {
    setFilters(s.filters);
    setSort(s.sort);
    setPreset(`saved:${s.name}`);
    setWatchOnly(false);
    setShown(PAGE);
  };
  const persist = (next: Saved[]) => {
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };
  const saveScreen = () => {
    const name = window.prompt('Name this screen')?.trim();
    if (!name) return;
    persist([...saved.filter((s) => s.name !== name), { name, filters, sort }]);
    setPreset(`saved:${name}`);
  };

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `nse-screen-${data?.asOf ?? ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onSort = (key: keyof Row) => {
    setSort(([k, d]) => (k === key ? [key, d === 1 ? -1 : 1] : [key, key === 's' ? 1 : -1]));
    setShown(PAGE);
  };

  const criteria = Object.keys(filters.ranges).length + filters.flags.length;
  const activePreset = PRESETS.find((p) => p.id === preset);

  if (loadError && !data) {
    return (
      <div className="empty-app">
        <h1>NSE Screener</h1>
        <p>No market data has been downloaded yet.</p>
        <button className="primary" onClick={refresh} disabled={syncing}>
          {syncing ? 'Downloading a year of NSE data…' : 'Download NSE data'}
        </button>
        {syncMsg && <p className="note">{syncMsg}</p>}
      </div>
    );
  }
  if (!data) return <div className="empty-app">Loading…</div>;

  return (
    <div className={`app ${selectedRow && view === 'screener' ? 'with-detail' : ''}`}>
      <header className="top">
        <h1>
          NSE Screener <span>End-of-day · {data.rows.length.toLocaleString('en-IN')} stocks</span>
        </h1>
        <div className="seg tabs" role="tablist">
          <button role="tab" aria-selected={view === 'brief'} className={view === 'brief' ? 'on' : ''} onClick={() => setView('brief')}>
            Brief
          </button>
          <button role="tab" aria-selected={view === 'screener'} className={view === 'screener' ? 'on' : ''} onClick={() => setView('screener')}>
            Screener
          </button>
          <button role="tab" aria-selected={view === 'backtest'} className={view === 'backtest' ? 'on' : ''} onClick={() => setView('backtest')}>
            Backtest
          </button>
        </div>
        <div className="top-right">
          {syncMsg && <span className="muted">{syncMsg}</span>}
          <span className="asof">Data as of {fmtDate(data.asOf)}</span>
          {!HOSTED && (
            <button onClick={refresh} disabled={syncing}>
              {syncing ? 'Refreshing…' : 'Refresh data'}
            </button>
          )}
        </div>
      </header>

      {view === 'brief' && (
        <Brief
          key={briefKey}
          watchlist={watchlist}
          onToggleWatch={toggleWatch}
          screens={briefScreens}
          onSaveScreens={saveBriefScreens}
          current={filters}
          onOpenStock={openStock}
          onOpenFilters={(f) => { setFilters({ ...EMPTY, ...f }); setPreset(null); setWatchOnly(false); setShown(PAGE); setView('screener'); }}
        />
      )}

      {view === 'backtest' && (
        <Backtest
          filters={filters}
          onOpenPreset={(id) => { applyPreset(id); setView('screener'); }}
          onOpenFilters={(f) => { setFilters(f); setPreset(null); setWatchOnly(false); setShown(PAGE); setView('screener'); }}
        />
      )}

      {view === 'screener' && <nav className="side">
        <section>
          <h3>Screens</h3>
          <ul className="presets">
            <li>
              <button className={preset === 'watch' ? 'on' : ''} onClick={showWatchlist}>
                ★ Watchlist <small>{Object.keys(watchlist).length}</small>
              </button>
            </li>
            {PRESETS.map((p) => (
              <li key={p.id}>
                <button className={preset === p.id ? 'on' : ''} onClick={() => applyPreset(p.id)} title={p.blurb}>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {saved.length > 0 && (
          <section>
            <h3>My screens</h3>
            <ul className="presets">
              {saved.map((s) => (
                <li key={s.name} className="saved">
                  <button className={preset === `saved:${s.name}` ? 'on' : ''} onClick={() => applySaved(s)}>
                    {s.name}
                  </button>
                  <button className="icon" aria-label={`Delete ${s.name}`} onClick={() => persist(saved.filter((x) => x !== s))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="side-head">
            <h3>Criteria{criteria > 0 && <em>{criteria}</em>}</h3>
            <div>
              {criteria > 0 && (
                <>
                  <button className="link" onClick={saveScreen}>Save</button>
                  <button className="link" onClick={() => update({ ranges: {}, flags: [] })}>Clear</button>
                </>
              )}
            </div>
          </div>

          <div className="flags">
            {FLAGS.map((f) => (
              <label key={f.key}>
                <input type="checkbox" checked={filters.flags.includes(f.key)} onChange={() => toggleFlag(f.key)} />
                {f.label}
              </label>
            ))}
          </div>

          {FIELD_GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend>{g.title}</legend>
              {g.fields.map((f) => {
                const r = filters.ranges[f.key];
                return (
                  <div className={`range ${r ? 'set' : ''}`} key={f.key} title={f.hint}>
                    <span>
                      {f.label}
                      {f.unit && <small> {f.unit}</small>}
                    </span>
                    <NumInput label={`${f.label} minimum`} placeholder="min" value={r?.[0] ?? null} onChange={(v) => setRange(f.key, 0, v)} />
                    <NumInput label={`${f.label} maximum`} placeholder="max" value={r?.[1] ?? null} onChange={(v) => setRange(f.key, 1, v)} />
                  </div>
                );
              })}
            </fieldset>
          ))}
        </section>
      </nav>}

      {view === 'screener' && <main>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search symbol or company"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            aria-label="Search"
          />
          <select value={filters.universe} onChange={(e) => update({ universe: e.target.value })} aria-label="Universe">
            {UNIVERSES.map((u) => (
              <option key={u.code} value={u.code}>{u.label}</option>
            ))}
          </select>
          <select value={filters.sector} onChange={(e) => update({ sector: e.target.value })} aria-label="Sector">
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="count">
            <b>{rows.length.toLocaleString('en-IN')}</b> {rows.length === 1 ? 'match' : 'matches'}
          </span>
          <button onClick={() => setView('backtest')} disabled={criteria === 0} title="See how this screen would have done over the last three years">
            Backtest this screen
          </button>
          <button onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        </div>

        {(activePreset || criteria > 0) && (
          <div className="chips">
            {activePreset && activePreset.id !== 'all' && <span className="blurb">{activePreset.blurb}</span>}
            {filters.flags.map((k) => (
              <button key={k} onClick={() => toggleFlag(k)}>
                {FLAGS.find((f) => f.key === k)!.label} ✕
              </button>
            ))}
            {(Object.entries(filters.ranges) as [NumKey, [number | null, number | null]][]).map(([k, r]) => (
              <button key={k} onClick={() => update({ ranges: Object.fromEntries(Object.entries(filters.ranges).filter(([x]) => x !== k)) })}>
                {describeRange(k, r)} ✕
              </button>
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sym" onClick={() => onSort('s')} aria-sort={sort[0] === 's' ? (sort[1] === 1 ? 'ascending' : 'descending') : undefined}>
                  Stock{sort[0] === 's' && <i>{sort[1] === 1 ? '▲' : '▼'}</i>}
                </th>
                <th className="sparkcol">3M trend</th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    title={c.title}
                    onClick={() => onSort(c.key)}
                    className={sort[0] === c.key ? 'sorted' : ''}
                    aria-sort={sort[0] === c.key ? (sort[1] === 1 ? 'ascending' : 'descending') : undefined}
                  >
                    {c.label}
                    {sort[0] === c.key && <i>{sort[1] === 1 ? '▲' : '▼'}</i>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r) => (
                <tr key={r.s} className={r.s === selected ? 'sel' : ''} onClick={() => setSelected(r.s === selected ? null : r.s)}>
                  <td className="sym">
                    <button
                      className={`star ${watchlist[r.s] ? 'on' : ''}`}
                      aria-label={watchlist[r.s] ? `Remove ${r.s} from watchlist` : `Add ${r.s} to watchlist`}
                      aria-pressed={!!watchlist[r.s]}
                      onClick={(e) => { e.stopPropagation(); toggleWatch(r.s); }}
                    >
                      {watchlist[r.s] ? '★' : '☆'}
                    </button>
                    <b>{r.s}</b>
                    {r.newHi === 1 && <mark className="hi" title="New 52-week high today">52W H</mark>}
                    {r.newLo === 1 && <mark className="lo" title="New 52-week low today">52W L</mark>}
                    {r.nextEx && <mark className="ex" title={`${r.nextEx.text}, ex-date ${fmtDate(r.nextEx.ex)}`}>EX {fmtDate(r.nextEx.ex, false)}</mark>}
                    <small>
                      {r.name}
                      {r.idx && ` · ${IDX_LABEL[r.idx]}`}
                    </small>
                  </td>
                  <td className="sparkcol"><Spark data={r.spark} /></td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={sort[0] === c.key ? 'sorted' : ''}>{c.cell(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="none">
              <p>{watchOnly && Object.keys(watchlist).length === 0 ? 'Your watchlist is empty. Click the ☆ next to any stock to add it.' : 'No stocks match these criteria.'}</p>
              <button onClick={() => applyPreset('all')}>Show all stocks</button>
            </div>
          )}
          {rows.length > shown && (
            <button className="more" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, rows.length - shown)} more of {(rows.length - shown).toLocaleString('en-IN')} remaining
            </button>
          )}
        </div>
        <footer>
          Source: NSE end-of-day bhavcopy archive · {data.sessions} sessions loaded. Not investment advice.
        </footer>
      </main>}

      {selectedRow && view === 'screener' && (
        <Detail
          row={selectedRow}
          onClose={closeDetail}
          watch={watchlist[selectedRow.s] ?? null}
          onToggleWatch={() => toggleWatch(selectedRow.s)}
          onEditWatch={(patch) => saveWatchlist((prev) => ({ ...prev, [selectedRow.s]: { ...prev[selectedRow.s], ...patch } }))}
        />
      )}
    </div>
  );
}
