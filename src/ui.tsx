import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtPct, fmtPrice, type Row } from './data';

const PATHS = {
  brief: 'M3 12.5h10M8 3v2M3.4 6.4l1.4 1.4M12.6 6.4l-1.4 1.4M4.5 12.5a3.5 3.5 0 0 1 7 0',
  screener: 'M2.5 3.5h11l-4.2 5v4l-2.6 1v-5z',
  chart: 'M4 2.5v11M4 5h0M4 5.5v4.5M8 4v9.5M8 6.5v4M12 2.5v9M12 4v4.5M3 5.5h2v4.5H3zM7 6.5h2v4H7zM11 4h2v4.5h-2z',
  paper: 'M2.5 12.5l3.5-4 2.5 2.5 5-6.5M10 4.5h3.5V8',
  options: 'M2 12.5c3 0 3.5-9 6-9s3 9 6 9M2 8h12',
  news: 'M3 3.5h8v9H4a1 1 0 0 1-1-1zM11 6h2v5.5a1 1 0 0 1-2 0M5 6h4M5 8.5h4M5 11h2.5',
  backtest: 'M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 3v2.5H5M8 5v3.2l2 1.3',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 3v2.5H11',
  sun: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
  auto: 'M8 2.5a5.5 5.5 0 1 0 0 11zM8 2.5a5.5 5.5 0 0 1 0 11',
  close: 'M4 4l8 8M12 4l-8 8',
  chevron: 'M6 4l4 4-4 4',
  bell: 'M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.8 14h2.4',
  filter: 'M2.5 4h11M4.5 8h7M6.5 12h3',
  download: 'M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10',
  arrowRight: 'M3 8h10M9.5 4.5 13 8l-3.5 3.5',
} as const;

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down');

/** A change shown as a tinted pill, so direction reads at a glance without relying on text colour alone. */
export function Delta({ value, digits = 2 }: { value: number | null | undefined; digits?: number }) {
  if (value == null) return <span className="muted">–</span>;
  return <span className={`pill ${tone(value)}`}>{fmtPct(value, digits)}</span>;
}

export function Spark({ data, width = 64, height = 20 }: { data: number[] | undefined; width?: number; height?: number }) {
  if (!data || data.length < 2) return <svg className="spark" style={{ width, height }} />;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 1 - ((v - lo) / (hi - lo || 1)) * (height - 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={`spark ${data[data.length - 1] >= data[0] ? 'up' : 'down'}`} style={{ width, height }} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} />
    </svg>
  );
}

/** 1–99 score with a small magnitude bar. */
export function Meter({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="muted">–</span>;
  return (
    <span className="meter" title={`Outperformed ${value}% of stocks`}>
      {value}
      <i><b style={{ width: `${value}%` }} /></i>
    </span>
  );
}

/** Where the price sits between its 52-week low and high. */
export function RangeBar({ low, high, value, title }: { low: number; high: number; value: number; title?: string }) {
  const pos = high > low ? Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100)) : 50;
  return (
    <span className="rangebar" title={title}>
      <i style={{ left: `${pos}%` }} />
    </span>
  );
}

export type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'nse-screener.theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || 'auto');
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const next = () => setTheme((t) => (t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto'));
  return [theme, next] as const;
}

/** Header search: find any stock by symbol or name and open it, from any tab. "/" focuses it. */
export function StockSearch({ rows, onPick }: { rows: Row[]; onPick: (symbol: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return [];
    const starts: Row[] = [];
    const contains: Row[] = [];
    for (const r of rows) {
      if (r.s.startsWith(t)) starts.push(r);
      else if (r.s.includes(t) || r.name.toUpperCase().includes(t)) contains.push(r);
      if (starts.length >= 8) break;
    }
    starts.sort((a, b) => a.s.length - b.s.length);
    return [...starts, ...contains].slice(0, 8);
  }, [q, rows]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (s: string) => {
    onPick(s);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="search" role="combobox" aria-expanded={open && hits.length > 0} aria-haspopup="listbox">
      <Icon name="search" />
      <input
        ref={input}
        value={q}
        placeholder="Find a stock"
        aria-label="Find a stock"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(hits.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' && hits[at]) pick(hits[at].s);
          else if (e.key === 'Escape') { setQ(''); input.current?.blur(); }
        }}
      />
      <kbd>/</kbd>
      {open && q.trim() && (
        <ul className="search-results" role="listbox">
          {hits.length === 0 && <li className="empty">No stock matches “{q.trim()}”</li>}
          {hits.map((r, i) => (
            <li key={r.s} role="option" aria-selected={i === at} className={i === at ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(r.s); }} onMouseEnter={() => setAt(i)}>
              <span><b>{r.s}</b><small>{r.name}</small></span>
              <span className="num">{fmtPrice(r.close)} <Delta value={r.chg} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
