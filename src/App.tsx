import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountPanel, type Me } from './Account';
import { Backtest } from './Backtest';
import { Brief } from './Brief';
import { APP_NAME } from './brand';
import { ChartTab } from './ChartTab';
import { Explain, HelpPanel } from './Help';
import { Home } from './Home';
import type { Term } from './glossary';
import { News } from './News';
import { Options } from './Options';
import { PaperTab } from './Paper';
import { JournalTab } from './Journal';
import { advancePaper } from './paperEngine';
import { Detail } from './Detail';
import { Etfs } from './Etfs';
import { NumInput } from './NumInput';
import { Delta, Icon, Meter, RangeBar, Spark, StockSearch, tone, useTheme } from './ui';
import { useBriefScreens, useDrawings, useJournal, usePaper, useWatchlist } from './user';
import {
  BUILD_LABEL, EMPTY, PATTERN_LABEL, FIELD_GROUPS, FLAGS, IDX_LABEL, PRESETS, UNIVERSES,
  HOSTED, applyFilters, describeRange, fmtCr, fmtMcap, fmtDate, fmtPct, fmtPrice, sortRows, toCsv,
  type Dataset, type Filters, type Flag, type NumKey, type Row,
} from './data';

type Sort = [keyof Row, 1 | -1];
interface Saved { name: string; filters: Filters; sort: Sort }

const PAGE = 100;
const STALE_AFTER = 5; // days without a new session before the app says so (covers a long weekend)
const SAVED_KEY = 'nse-screener.saved';

const loadSaved = (): Saved[] => {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
  } catch {
    return [];
  }
};

const pctCell = (v: number | null) => <span className={tone(v)}>{fmtPct(v)}</span>;

const COLUMNS: { key: keyof Row; label: string; term?: Term; title?: string; cell: (r: Row) => React.ReactNode }[] = [
  { key: 'close', label: 'Price', cell: (r) => fmtPrice(r.close) },
  { key: 'chg', label: 'Day', cell: (r) => <Delta value={r.chg} /> },
  { key: 'w1', label: '1W', cell: (r) => pctCell(r.w1) },
  { key: 'm1', label: '1M', cell: (r) => pctCell(r.m1) },
  { key: 'm3', label: '3M', cell: (r) => pctCell(r.m3) },
  { key: 'm6', label: '6M', cell: (r) => pctCell(r.m6) },
  { key: 'y1', label: '1Y', cell: (r) => pctCell(r.y1) },
  { key: 'rs', label: 'RS', term: 'rs', title: 'Relative strength, 1–99: share of stocks outperformed over the past year', cell: (r) => <Meter value={r.rs} /> },
  {
    key: 'foOiChg', label: 'Fut OI', term: 'futOi', title: 'Change in futures open interest today, and what it means with the price move (F&O stocks only)',
    cell: (r) =>
      r.fo ? (
        <span className="oi-cell">
          {r.build && <span className={`tag ${r.build === 'LB' || r.build === 'SC' ? 'up' : 'down'}`} title={BUILD_LABEL[r.build]}>{r.build}</span>}
          {fmtPct(r.foOiChg)}
        </span>
      ) : <span className="muted">–</span>,
  },
  { key: 'mcap', label: 'M.Cap', title: 'Market capitalisation, ₹ crore', cell: (r) => fmtMcap(r.mcap) },
  { key: 'pe', label: 'P/E', term: 'pe', title: 'NSE trailing P/E', cell: (r) => (r.pe == null ? '–' : r.pe.toFixed(1)) },
  { key: 'rsi', label: 'RSI', term: 'rsi', title: '14-session RSI', cell: (r) => (r.rsi == null ? '–' : r.rsi.toFixed(0)) },
  { key: 'vs50', label: 'vs 50D', title: 'Price vs 50-day moving average', cell: (r) => pctCell(r.vs50) },
  { key: 'vs200', label: 'vs 200D', term: 'dma', title: 'Price vs 200-day moving average', cell: (r) => pctCell(r.vs200) },
  {
    key: 'fromHi', label: '52W range', term: 'range52', title: 'Where the price sits between its 52-week low and high, and the distance from the high',
    cell: (r) => (
      <span className="range-cell">
        <RangeBar low={r.lo52} high={r.hi52} value={r.close} title={`52-week low ₹${fmtPrice(r.lo52)}, high ₹${fmtPrice(r.hi52)}`} />
        {fmtPct(r.fromHi)}
      </span>
    ),
  },
  { key: 'volX', label: 'Vol ×', term: 'volX', title: 'Volume vs 20-session average', cell: (r) => (r.volX == null ? '–' : `${r.volX.toFixed(1)}×`) },
  { key: 'deliv', label: 'Deliv', term: 'deliv', title: 'Delivery percentage', cell: (r) => (r.deliv == null ? '–' : `${r.deliv.toFixed(0)}%`) },
  { key: 'avgTurnover', label: 'Turnover', term: 'turnover', title: '20-session average daily turnover, ₹ crore', cell: (r) => fmtCr(r.avgTurnover) },
];

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<Sort>(['avgTurnover', -1]);
  const [preset, setPreset] = useState<string | null>('all');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [view, setView] = useState<'home' | 'brief' | 'screener' | 'etfs' | 'chart' | 'paper' | 'journal' | 'options' | 'news' | 'backtest'>('home');
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  // help: opens by itself the first time someone visits on this device
  const [help, setHelp] = useState<'welcome' | 'glossary' | null>(() => {
    try {
      return localStorage.getItem('nse-screener.welcomed') ? null : 'welcome';
    } catch {
      return null;
    }
  });
  const closeHelp = useCallback(() => {
    setHelp(null);
    try { localStorage.setItem('nse-screener.welcomed', '1'); } catch { /* private mode */ }
  }, []);
  const [drawings, saveDrawings] = useDrawings();
  const [journal, saveJournal] = useJournal();
  const [journalSymbol, setJournalSymbol] = useState<string | null>(null);
  const [paper, savePaper, paperLoaded, reloadPaper] = usePaper();
  // who is signed in (hosted site only; the local app has a single user)
  const [me, setMe] = useState<Me | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    if (!HOSTED) return; // the local app has no sign-in
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((u) => u?.name && setMe(u)).catch(() => {});
  }, []);
  const [watchlist, saveWatchlist] = useWatchlist();
  const [briefScreens, saveBriefScreens] = useBriefScreens();
  const [watchOnly, setWatchOnly] = useState(false);
  // phones show the criteria only on request; the screen list stays visible
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [briefKey, setBriefKey] = useState(0);
  const [theme, nextTheme] = useTheme();
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
      reloadPaper();
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
    // the watchlist view includes starred ETFs as well as stocks
    () => (data ? sortRows(applyFilters(watchOnly ? [...data.rows, ...(data.etfs ?? [])].filter((r) => watchlist[r.s]) : data.rows, filters), sort[0], sort[1]) : []),
    [data, filters, sort, watchOnly, watchlist],
  );
  // stocks and ETFs together: for search, the stock panel, the chart, the watchlist and paper trades
  const everything = useMemo(() => [...(data?.rows ?? []), ...(data?.etfs ?? [])], [data]);
  const rowOf = useMemo(() => new Map(everything.map((r) => [r.s, r])), [everything]);
  const selectedRow = useMemo(() => (selected ? rowOf.get(selected) ?? null : null), [rowOf, selected]);

  // bring the paper account up to the latest session (fills, stops, targets, account value)
  const advancing = useRef(false);
  useEffect(() => {
    if (!data || !paperLoaded || advancing.current) return;
    if (paper.last != null && paper.last >= data.asOf) return;
    advancing.current = true;
    advancePaper(paper, data.asOf)
      .then((next) => next && savePaper(next))
      .finally(() => { advancing.current = false; });
  }, [data, paper, paperLoaded, savePaper]);
  const visible = useMemo(() => rows.slice(0, shown), [rows, shown]);

  // ↑/↓ steps through the results while a stock is open in the Screener
  useEffect(() => {
    if (view !== 'screener' || !selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      const i = visible.findIndex((r) => r.s === selected);
      const next = visible[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (i < 0 || !next) return;
      e.preventDefault();
      setSelected(next.s);
      document.querySelector(`tr[data-s="${CSS.escape(next.s)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, selected, visible]);
  const closeDetail = useCallback(() => setSelected(null), []);

  const toggleWatch = (s: string) => {
    saveWatchlist((prev) => {
      const next = { ...prev };
      if (next[s]) delete next[s];
      else next[s] = { added: data?.asOf ?? 0, note: '', level: null, price: rowOf.get(s)?.close };
      return next;
    });
  };
  const viewRef = useRef(view);
  viewRef.current = view;
  // on the Chart tab a stock opens in the chart itself; elsewhere it opens the side panel
  const openStock = useCallback((s: string) => (viewRef.current === 'chart' ? setChartSymbol(s) : setSelected(s)), []);
  const openChart = useCallback((s: string) => {
    setChartSymbol(s);
    setSelected(null);
    setView('chart');
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
  // days since the latest session, counted in India time
  const staleDays = data
    ? Math.floor((Date.now() + 5.5 * 36e5 - Date.UTC(Math.floor(data.asOf / 10000), (Math.floor(data.asOf / 100) % 100) - 1, data.asOf % 100)) / 864e5)
    : 0;
  const activePreset = PRESETS.find((p) => p.id === preset);

  if (loadError && !data) {
    return (
      <div className="empty-app">
        <h1>{APP_NAME}</h1>
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
    <div className={`app view-${view} ${selectedRow && view === 'screener' ? 'with-detail' : ''} ${filtersOpen ? 'filters-open' : ''}`}>
      {view !== 'home' && staleDays >= STALE_AFTER && (
        <p className="stale-banner" role="status">
          Prices are from {fmtDate(data.asOf)}, {staleDays} days ago. The evening update may not have run{HOSTED ? '.' : '; click Refresh to fetch the latest.'}
        </p>
      )}
      {accountOpen && me && <AccountPanel me={me} onClose={() => setAccountOpen(false)} />}
      {help && <HelpPanel start={help} onClose={closeHelp} onOpenBrief={() => setView('brief')} />}

      {view === 'home' && <Home onHelp={() => setHelp('welcome')} data={data} searchRows={everything} onGo={setView} onPick={openStock} theme={theme} onTheme={nextTheme} />}

      {view !== 'home' && <header className="top">
        <button className="brand" onClick={() => setView('home')} title={`${APP_NAME} home`}>
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 17l5-6 4 3 6-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="18" cy="5" r="2.2" fill="currentColor" /></svg>
          </span>
          <h1>{APP_NAME}</h1>
        </button>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {([['brief', 'Brief'], ['screener', 'Screener'], ['etfs', 'ETFs'], ['chart', 'Chart'], ['paper', 'Paper'], ['journal', 'Journal'], ['options', 'Options'], ['news', 'News'], ['backtest', 'Backtest']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
              <Icon name={id} />
              {label}
            </button>
          ))}
        </nav>
        <StockSearch rows={everything} onPick={openStock} />
        <div className="top-right">
          {syncMsg && <span className="muted">{syncMsg}</span>}
          <span className={`asof ${staleDays >= STALE_AFTER ? 'stale' : ''}`} title={staleDays >= STALE_AFTER ? `These prices are ${staleDays} days old. The evening update may not have run.` : `${data.rows.length.toLocaleString('en-IN')} stocks · end-of-day data`}>
            <i />
            {fmtDate(data.asOf)} close
          </span>
          {!HOSTED && (
            <button className="ghost" onClick={refresh} disabled={syncing} title="Download the latest NSE session and rebuild the brief">
              <span className={syncing ? 'spin' : ''}><Icon name="refresh" /></span>
              {syncing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          {me && (
            <button className="ghost account-chip" onClick={() => setAccountOpen(true)} title="Your account: password, devices, your data">
              <span className="avatar" aria-hidden>{me.name[0].toUpperCase()}</span>
              {me.name}
            </button>
          )}
          <button className="ghost square" onClick={() => setHelp('welcome')} aria-label="Help" title="How Sensa works, and what the terms mean">?</button>
          <button className="ghost square" onClick={nextTheme} aria-label={`Theme: ${theme}. Click to change.`} title={`Theme: ${theme}`}>
            <Icon name={theme === 'auto' ? 'auto' : theme === 'dark' ? 'moon' : 'sun'} />
          </button>
        </div>
      </header>}

      {view === 'brief' && (
        <Brief
          key={briefKey}
          watchlist={watchlist}
          onToggleWatch={toggleWatch}
          screens={briefScreens}
          onSaveScreens={saveBriefScreens}
          current={filters}
          onOpenStock={openStock}
          rowOf={rowOf}
          onGoScreener={() => setView('screener')}
          onRebuilt={reloadPaper}
          canEditScreens={!HOSTED || !!me?.admin}
          onOpenFilters={(f) => { setFilters({ ...EMPTY, ...f }); setPreset(null); setWatchOnly(false); setShown(PAGE); setView('screener'); }}
        />
      )}

      {view === 'etfs' && <Etfs etfs={data.etfs ?? []} watchlist={watchlist} onToggleWatch={toggleWatch} onOpenStock={openStock} selected={selected} />}

      {view === 'chart' && (
        <ChartTab
          symbol={chartSymbol ?? selected ?? Object.keys(watchlist)[0] ?? (rowOf.has('RELIANCE') ? 'RELIANCE' : data.rows[0].s)}
          onSymbol={setChartSymbol}
          rowOf={rowOf}
          results={visible}
          watchlist={watchlist}
          paper={paper}
          theme={theme}
          drawings={drawings}
          onSaveDrawings={saveDrawings}
          onToggleWatch={toggleWatch}
          onSetLevel={(s, level) => saveWatchlist((prev) => ({ ...prev, [s]: { ...(prev[s] ?? { added: data.asOf, note: '' }), level } }))}
        />
      )}

      {view === 'paper' && <PaperTab paper={paper} onSave={savePaper} onReload={reloadPaper} rowOf={rowOf} asOf={data.asOf} onOpenStock={openStock} onGoScreener={() => setView('screener')} />}

      {view === 'journal' && <JournalTab journal={journal} onSave={saveJournal} rowOf={rowOf} asOf={data.asOf} onOpenStock={openStock} prefill={journalSymbol} />}

      {view === 'options' && <Options key={briefKey} />}

      {view === 'news' && <News key={briefKey} watchlist={watchlist} rowOf={rowOf} onOpenStock={openStock} />}

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
              <button className={`watch ${preset === 'watch' ? 'on' : ''}`} onClick={showWatchlist}>
                <span>★ Watchlist</span> <small>{Object.keys(watchlist).length}</small>
              </button>
            </li>
            {PRESETS.filter((p) => !p.group).map((p) => (
              <li key={p.id}>
                <button className={preset === p.id ? 'on' : ''} onClick={() => applyPreset(p.id)} title={p.blurb}>
                  <span>{p.label}</span>
                  {preset === p.id && p.id !== 'all' && <em>{p.blurb}</em>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Chart patterns <Explain term="pattern" /></h3>
          <ul className="presets">
            {PRESETS.filter((p) => p.group === 'pattern').map((p) => (
              <li key={p.id}>
                <button className={preset === p.id ? 'on' : ''} onClick={() => applyPreset(p.id)} title={p.blurb}>
                  <span>{p.label}</span>
                  <small>{data.rows.filter((r) => r.pat.includes(p.filters.flags![0] as never)).length}</small>
                  {preset === p.id && <em>{p.blurb}</em>}
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

          {FIELD_GROUPS.map((g, gi) => {
            const active = g.fields.filter((f) => filters.ranges[f.key]).length;
            return (
            <details className="group" key={g.title} open={active > 0 || gi === 0}>
              <summary>
                <Icon name="chevron" size={12} />
                {g.title}
                {active > 0 && <em>{active}</em>}
              </summary>
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
            </details>
            );
          })}
        </section>
      </nav>}

      {view === 'screener' && <main>
        <div className="toolbar">
          <button className="filters-toggle" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
            <Icon name="filter" /> {filtersOpen ? 'Hide filters' : 'Filters'}{criteria > 0 && <em>{criteria}</em>}
          </button>
          <input
            type="search"
            placeholder="Filter these results"
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
            <Icon name="backtest" /> Backtest this screen
          </button>
          <button onClick={exportCsv} disabled={!rows.length} title="Download these results as a spreadsheet">
            <Icon name="download" /> CSV
          </button>
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
                    {c.term && <Explain term={c.term} />}
                    {sort[0] === c.key && <i>{sort[1] === 1 ? '▲' : '▼'}</i>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.s} data-s={r.s} className={r.s === selected ? 'sel' : ''} onClick={() => setSelected(r.s === selected ? null : r.s)}>
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
                    {r.bm?.results && <mark className="res" title={`Board meeting to consider results on ${fmtDate(r.bm.date)}`}>RESULTS {fmtDate(r.bm.date, false)}</mark>}
                    {r.pat.map((p) => <mark key={p} className="pat" title={`Chart pattern: ${PATTERN_LABEL[p]}`}>{PATTERN_LABEL[p]}</mark>)}
                    {r.ban === 1 && <mark className="lo" title="In the F&O ban period: no new derivative positions allowed">BAN</mark>}
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
              <Icon name="filter" size={28} />
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
          <span>Source: NSE end-of-day archive · {data.rows.length.toLocaleString('en-IN')} stocks · {data.sessions} sessions. Not investment advice.</span>
          <span className="keys"><kbd>/</kbd> find a stock · <kbd>↑</kbd><kbd>↓</kbd> step through results · <kbd>Esc</kbd> close</span>
        </footer>
      </main>}

      {selectedRow && view !== 'screener' && view !== 'chart' && <div className="scrim" onClick={closeDetail} />}
      {selectedRow && view !== 'chart' && (
        <Detail
          onOpenChart={() => openChart(selectedRow.s)}
          onLogTrade={() => { setJournalSymbol(selectedRow.s); closeDetail(); setView('journal'); }}
          onOpen={openStock}
          key={view === 'screener' ? 'docked' : 'floating'}
          floating={view !== 'screener'}
          row={selectedRow}
          onClose={closeDetail}
          watch={watchlist[selectedRow.s] ?? null}
          onToggleWatch={() => toggleWatch(selectedRow.s)}
          paper={paper}
          onSavePaper={savePaper}
          asOf={data.asOf}
          rowOf={rowOf}
          onEditWatch={(patch) => saveWatchlist((prev) => ({ ...prev, [selectedRow.s]: { ...prev[selectedRow.s], ...patch } }))}
        />
      )}
    </div>
  );
}
