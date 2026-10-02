import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, PriceScaleMode,
  createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type SeriesMarker, type SeriesType, type Time,
} from 'lightweight-charts';
import { PATTERN_LABEL, fileSafe, fmtDate, fmtPct, fmtPrice, fmtQty, type History, type Row } from './data';
import { Delta, Icon, tone, type Theme } from './ui';
import type { Drawing, Paper, Watchlist } from './user';

type Timeframe = 'D' | 'W' | 'M';
type Kind = 'candles' | 'line' | 'area';
type Tool = 'none' | 'h' | 't';
interface Bar { date: number; time: Time; o: number; h: number; l: number; c: number; v: number; dl: number | null; oi: number | null }
interface Settings { tf: Timeframe; kind: Kind; log: boolean; ind: Record<string, boolean> }

const INDICATORS: { id: string; label: string; pane?: boolean; hint?: string }[] = [
  { id: 'sma20', label: '20-day average' },
  { id: 'sma50', label: '50-day average' },
  { id: 'sma200', label: '200-day average' },
  { id: 'ema20', label: '20-day exponential average', hint: 'Like the 20-day average but weighted towards recent days' },
  { id: 'bb', label: 'Bollinger bands', hint: '20-day average with bands two standard deviations either side' },
  { id: 'vol', label: 'Volume' },
  { id: 'rsi', label: 'RSI (14)', pane: true, hint: 'Momentum from 0 to 100; above 70 is often called overbought, below 30 oversold' },
  { id: 'macd', label: 'MACD (12, 26, 9)', pane: true, hint: 'The gap between a fast and a slow average, with its own signal line' },
  { id: 'deliv', label: 'Delivery %', pane: true, hint: 'Share of traded quantity taken for delivery' },
  { id: 'oi', label: 'Futures open interest', pane: true, hint: 'F&O stocks only' },
];
const DEFAULTS: Settings = { tf: 'D', kind: 'candles', log: false, ind: { sma50: true, sma200: true, vol: true } };
const KEY = 'nse-screener.chart';
const loadSettings = (): Settings => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
};

const iso = (d: number) => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}-${String(d % 100).padStart(2, '0')}`;
const toKey = (t: Time) => Number(String(t).replace(/-/g, ''));
const dayNumber = (d: number) => Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100) / 864e5;

function toBars(h: History, tf: Timeframe): Bar[] {
  const out: Bar[] = [];
  let key = -1;
  for (let i = 0; i < h.d.length; i++) {
    const d = h.d[i];
    // weeks run Monday to Friday; 1 Jan 1970 was a Thursday
    const k = tf === 'D' ? i : tf === 'W' ? Math.floor((dayNumber(d) + 3) / 7) : Math.floor(d / 100);
    const dl = h.dl[i], oi = h.oi?.[i] ?? null;
    if (k !== key) {
      key = k;
      out.push({ date: d, time: iso(d), o: h.o[i], h: h.h[i], l: h.l[i], c: h.c[i], v: h.v[i], dl, oi });
    } else {
      const b = out[out.length - 1];
      b.h = Math.max(b.h, h.h[i]);
      b.l = Math.min(b.l, h.l[i]);
      b.c = h.c[i];
      b.v += h.v[i];
      b.dl = dl ?? b.dl;
      b.oi = oi ?? b.oi;
    }
  }
  return out;
}

// ---------- indicator maths (null until there is enough history) ----------
function sma(v: number[], n: number) {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}
function ema(v: (number | null)[], n: number) {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let prev: number | null = null, seen = 0, seed = 0;
  for (const x of v) {
    if (x == null) { out.push(null); continue; }
    if (prev == null) {
      seed += x;
      if (++seen === n) prev = seed / n;
      out.push(prev);
    } else {
      prev = x * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
}
function bollinger(v: number[], n = 20, width = 2) {
  const mid = sma(v, n);
  return v.map((_, i) => {
    const m = mid[i];
    if (m == null) return null;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (v[j] - m) ** 2;
    const sd = Math.sqrt(sq / n);
    return [m - width * sd, m + width * sd] as const;
  });
}
function rsi(v: number[], n = 14) {
  const out: (number | null)[] = [null];
  let gain = 0, loss = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (i <= n) { gain += Math.max(d, 0) / n; loss += Math.max(-d, 0) / n; }
    else { gain = (gain * (n - 1) + Math.max(d, 0)) / n; loss = (loss * (n - 1) + Math.max(-d, 0)) / n; }
    out.push(i >= n ? (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)) : null);
  }
  return out;
}

function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: v('--surface'), text: v('--ink-2'), grid: v('--line-soft'), line: v('--line'), ink: v('--ink'), muted: v('--ink-3'),
    up: v('--up'), down: v('--down'), blue: v('--s-price'), amber: v('--s-sma50'), purple: v('--s-sma200'), vol: v('--vol'), warn: v('--warn'), accent: v('--accent'),
  };
}

interface Geo {
  w: number;
  h: number;
  lines: { id: number; x1: number; y1: number; x2: number; y2: number; type: 'h' | 't' }[];
  shapes: { code: string; x: number; y: number; w: number; h: number }[];
}

export function ChartTab({ symbol, onSymbol, rowOf, results, watchlist, paper, theme, drawings, onSaveDrawings, onSetLevel, onToggleWatch }: {
  symbol: string;
  onSymbol: (s: string) => void;
  rowOf: Map<string, Row>;
  /** The Screener's current results, for the side list */
  results: Row[];
  watchlist: Watchlist;
  paper: Paper;
  theme: Theme;
  drawings: Record<string, Drawing[]>;
  onSaveDrawings: (update: (prev: Record<string, Drawing[]>) => Record<string, Drawing[]>) => void;
  onSetLevel: (s: string, level: number) => void;
  onToggleWatch: (s: string) => void;
}) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [hist, setHist] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);
  const [compare, setCompare] = useState('');
  const [compareData, setCompareData] = useState<{ d: number[]; c: number[] } | null>(null);
  const [indices, setIndices] = useState<Record<string, { d: number[]; c: number[] }>>({});
  const [menu, setMenu] = useState(false);
  const [tool, setTool] = useState<Tool>('none');
  const [pendingPoint, setPendingPoint] = useState<{ d: number; p: number } | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  const [geo, setGeo] = useState<Geo>({ w: 0, h: 0, lines: [], shapes: [] });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [list, setList] = useState<'watch' | 'results'>(Object.keys(watchlist).length ? 'watch' : 'results');
  const [scheme, setScheme] = useState(0); // bumps when the OS light/dark setting flips

  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const rangeRef = useRef<{ key: string; range: { from: number; to: number } | null }>({ key: '', range: null });

  const row = rowOf.get(symbol);
  const mine = drawings[symbol] ?? [];
  const update = (patch: Partial<Settings>) => setSettings((s) => {
    const next = { ...s, ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  });

  useEffect(() => {
    fetch('/data/idx.json').then((r) => (r.ok ? r.json() : {})).then(setIndices).catch(() => {});
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const flip = () => setScheme((n) => n + 1);
    mq.addEventListener('change', flip);
    return () => mq.removeEventListener('change', flip);
  }, []);

  useEffect(() => {
    let live = true;
    setHist(null);
    setFailed(false);
    setSelectedLine(null);
    setPendingPoint(null);
    fetch(`/data/h/${fileSafe(symbol)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h) => live && setHist(h))
      .catch(() => live && setFailed(true));
    return () => void (live = false);
  }, [symbol]);

  useEffect(() => {
    if (!compare) return void setCompareData(null);
    if (indices[compare]) return void setCompareData(indices[compare]);
    let live = true;
    fetch(`/data/h/${fileSafe(compare)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h: History) => live && setCompareData({ d: h.d, c: h.c }))
      .catch(() => live && setCompareData(null));
    return () => void (live = false);
  }, [compare, indices]);

  const bars = useMemo(() => (hist ? toBars(hist, settings.tf) : []), [hist, settings.tf]);
  const barAt = useCallback((d: number) => {
    // the bar that contains a date (weekly and monthly bars start on their first session)
    let i = bars.length - 1;
    while (i > 0 && bars[i].date > d) i--;
    return i;
  }, [bars]);

  // ---------- build the chart ----------
  useEffect(() => {
    const el = holder.current;
    if (!el || !bars.length) return;
    const c = palette();
    const { ind, kind, log } = settings;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text, fontFamily: 'Inter, -apple-system, sans-serif', fontSize: 11, panes: { separatorColor: c.line, enableResize: true } },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: c.line, mode: compareData ? PriceScaleMode.Percentage : log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: c.line, rightOffset: 8 },
    });
    chartRef.current = chart;
    const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
    const closes = bars.map((b) => b.c);
    const points = (vals: (number | null)[]) => bars.flatMap((b, i) => (vals[i] == null ? [] : [{ time: b.time, value: vals[i]! }]));

    const main: ISeriesApi<SeriesType> =
      kind === 'candles'
        ? chart.addSeries(CandlestickSeries, { upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down, borderVisible: false })
        : kind === 'line'
          ? chart.addSeries(LineSeries, { color: c.blue, lineWidth: 2 })
          : chart.addSeries(AreaSeries, { lineColor: c.blue, lineWidth: 2, topColor: `${c.blue}55`, bottomColor: `${c.blue}05` });
    if (kind === 'candles') main.setData(bars.map((b) => ({ time: b.time, open: b.o, high: b.h, low: b.l, close: b.c })));
    else main.setData(bars.map((b) => ({ time: b.time, value: b.c })));
    mainRef.current = main;

    if (ind.vol) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', ...quiet });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      vol.setData(bars.map((b, i) => ({ time: b.time, value: b.v, color: `${i && b.c < bars[i - 1].c ? c.down : c.up}55` })));
    }
    const overlay = (vals: (number | null)[], color: string, dashed = false, width: 1 | 2 = 2) =>
      chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid, ...quiet }).setData(points(vals));
    if (ind.sma20) overlay(sma(closes, 20), c.blue, false, 1);
    if (ind.ema20) overlay(ema(closes, 20), c.blue, true, 1);
    if (ind.sma50) overlay(sma(closes, 50), c.amber);
    if (ind.sma200) overlay(sma(closes, 200), c.purple);
    if (ind.bb) {
      const bb = bollinger(closes);
      overlay(bb.map((x) => x?.[0] ?? null), c.muted, false, 1);
      overlay(bb.map((x) => x?.[1] ?? null), c.muted, false, 1);
    }
    if (compareData) {
      const at = new Map(compareData.d.map((d, i) => [d, compareData.c[i]]));
      chart.addSeries(LineSeries, { color: c.ink, lineWidth: 2, priceLineVisible: false, title: compare }).setData(
        bars.flatMap((b) => {
          const v = at.get(b.date);
          return v == null ? [] : [{ time: b.time, value: v }];
        }),
      );
    }

    // separate panes below the price
    let pane = 1;
    if (ind.rsi) {
      const s = chart.addSeries(LineSeries, { color: c.purple, lineWidth: 2, priceLineVisible: false, title: 'RSI' }, pane++);
      s.setData(points(rsi(closes)));
      for (const level of [70, 30]) s.createPriceLine({ price: level, color: c.muted, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false });
    }
    if (ind.macd) {
      const fast = ema(closes, 12), slow = ema(closes, 26);
      const macd = closes.map((_, i) => (fast[i] != null && slow[i] != null ? fast[i]! - slow[i]! : null));
      const signal = ema(macd, 9);
      const p = pane++;
      chart.addSeries(HistogramSeries, { ...quiet }, p).setData(
        bars.flatMap((b, i) => (macd[i] == null || signal[i] == null ? [] : [{ time: b.time, value: macd[i]! - signal[i]!, color: `${macd[i]! >= signal[i]! ? c.up : c.down}88` }])),
      );
      chart.addSeries(LineSeries, { color: c.blue, lineWidth: 2, priceLineVisible: false, title: 'MACD' }, p).setData(points(macd));
      chart.addSeries(LineSeries, { color: c.amber, lineWidth: 1, ...quiet }, p).setData(points(signal));
    }
    if (ind.deliv) {
      chart.addSeries(HistogramSeries, { color: `${c.blue}99`, priceLineVisible: false, title: 'Delivery %' }, pane++).setData(points(bars.map((b) => b.dl)));
    }
    if (ind.oi && bars.some((b) => b.oi != null)) {
      chart.addSeries(LineSeries, { color: c.amber, lineWidth: 2, priceLineVisible: false, priceFormat: { type: 'volume' }, title: 'Futures OI' }, pane++).setData(points(bars.map((b) => b.oi)));
    }
    const panes = chart.panes();
    panes[0].setStretchFactor(3 + panes.length);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1.4);

    // what the app knows about this stock
    const level = watchlist[symbol]?.level;
    if (level) main.createPriceLine({ price: level, color: c.warn, lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'Your level' });
    const pos = paper.positions.find((p) => p.s === symbol);
    if (pos) {
      main.createPriceLine({ price: pos.entry, color: c.accent, lineWidth: 1, lineStyle: LineStyle.Solid, title: `Paper buy · ${pos.qty}` });
      if (pos.stop) main.createPriceLine({ price: pos.stop, color: c.down, lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'Stop' });
      if (pos.target) main.createPriceLine({ price: pos.target, color: c.up, lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'Target' });
    }
    for (const p of hist?.pat ?? []) main.createPriceLine({ price: p.level, color: c.purple, lineWidth: 1, lineStyle: LineStyle.Dashed, title: `${PATTERN_LABEL[p.code]} pivot` });
    const markers: SeriesMarker<Time>[] = [];
    for (const e of hist?.ca ?? []) {
      if (e.date < bars[0].date) continue;
      markers.push({ time: bars[barAt(e.date)].time, position: 'aboveBar', color: c.purple, shape: 'arrowDown', text: e.text ?? 'Price adjusted' });
    }
    for (const a of hist?.acts ?? []) {
      if (!/DIV/i.test(a.text) || a.ex < bars[0].date || a.ex > bars[bars.length - 1].date) continue;
      markers.push({ time: bars[barAt(a.ex)].time, position: 'belowBar', color: c.muted, shape: 'circle', text: 'D' });
    }
    markers.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));
    if (markers.length) createSeriesMarkers(main, markers);

    // keep the zoom when only settings changed; otherwise show the last ~9 months of bars
    const key = `${symbol}|${settings.tf}`;
    const saved = rangeRef.current.key === key ? rangeRef.current.range : null;
    const show = settings.tf === 'D' ? 190 : settings.tf === 'W' ? 110 : 60;
    chart.timeScale().setVisibleLogicalRange(saved ?? { from: Math.max(0, bars.length - show), to: bars.length + 6 });
    rangeRef.current.key = key;
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { rangeRef.current.range = r; });
    chart.subscribeCrosshairMove((p) => setHoverBar(p.time ? barAt(toKey(p.time)) : null));

    return () => {
      chartRef.current = null;
      mainRef.current = null;
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, settings, compareData, theme, scheme, watchlist[symbol]?.level, paper.positions, hist]);

  // ---------- drawings and pattern shading, positioned from the chart's own scales ----------
  useEffect(() => {
    let frame = 0;
    let last = '';
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const chart = chartRef.current, main = mainRef.current;
      if (!chart || !main || !bars.length) return;
      const ts = chart.timeScale();
      const w = ts.width(), h = chart.panes()[0].getHeight();
      const x = (d: number) => ts.timeToCoordinate(bars[barAt(d)].time);
      const y = (p: number) => main.priceToCoordinate(p);
      const lines: Geo['lines'] = [];
      for (const d of mine) {
        const y1 = y(d.p1);
        if (y1 == null) continue;
        if (d.type === 'h') lines.push({ id: d.id, type: 'h', x1: 0, y1, x2: w, y2: y1 });
        else {
          const x1 = x(d.d1), x2 = x(d.d2!), y2 = y(d.p2!);
          if (x1 != null && x2 != null && y2 != null) lines.push({ id: d.id, type: 't', x1, y1, x2, y2 });
        }
      }
      const shapes: Geo['shapes'] = [];
      for (const p of hist?.pat ?? []) {
        const x1 = x(p.from), x2 = ts.timeToCoordinate(bars[bars.length - 1].time), top = y(p.level), bottom = y(p.low);
        if (x1 != null && x2 != null && top != null && bottom != null) shapes.push({ code: p.code, x: x1, y: top, w: Math.max(2, x2 - x1), h: Math.max(2, bottom - top) });
      }
      const next = { w, h, lines, shapes };
      const sig = JSON.stringify(next);
      if (sig !== last) { last = sig; setGeo(next); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [bars, mine, hist, barAt]);

  const pointAt = (e: React.PointerEvent) => {
    const chart = chartRef.current, main = mainRef.current;
    if (!chart || !main) return null;
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left, py = e.clientY - box.top;
    const time = chart.timeScale().coordinateToTime(px);
    const price = main.coordinateToPrice(py);
    if (price == null) return null;
    return { d: time ? toKey(time) : bars[bars.length - 1].date, p: Math.round(price * 100) / 100, px, py };
  };
  const place = (e: React.PointerEvent) => {
    const pt = pointAt(e);
    if (!pt) return;
    const add = (d: Drawing) => onSaveDrawings((prev) => ({ ...prev, [symbol]: [...(prev[symbol] ?? []), d] }));
    if (tool === 'h') {
      add({ id: Date.now(), type: 'h', d1: pt.d, p1: pt.p });
      setTool('none');
    } else if (tool === 't') {
      if (!pendingPoint) setPendingPoint({ d: pt.d, p: pt.p });
      else {
        add({ id: Date.now(), type: 't', d1: pendingPoint.d, p1: pendingPoint.p, d2: pt.d, p2: pt.p });
        setPendingPoint(null);
        setTool('none');
      }
    }
  };
  const removeLine = useCallback((id: number) => {
    onSaveDrawings((prev) => ({ ...prev, [symbol]: (prev[symbol] ?? []).filter((d) => d.id !== id) }));
    setSelectedLine(null);
  }, [onSaveDrawings, symbol]);

  // ---------- side list and keys ----------
  const items = useMemo(() => {
    const src = list === 'watch' ? Object.keys(watchlist).map((s) => rowOf.get(s)).filter((r): r is Row => !!r) : results.slice(0, 150);
    return src;
  }, [list, watchlist, results, rowOf]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape') { setTool('none'); setPendingPoint(null); setSelectedLine(null); setMenu(false); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLine != null) removeLine(selectedLine);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const i = items.findIndex((r) => r.s === symbol);
        const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) { e.preventDefault(); onSymbol(next.s); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, symbol, onSymbol, selectedLine, removeLine]);

  const shown = bars[hoverBar ?? bars.length - 1];
  const before = bars[(hoverBar ?? bars.length - 1) - 1];
  const picked = mine.find((d) => d.id === selectedLine);
  const pendingGeo = pendingPoint && cursor && chartRef.current && mainRef.current
    ? { x: chartRef.current.timeScale().timeToCoordinate(bars[barAt(pendingPoint.d)].time), y: mainRef.current.priceToCoordinate(pendingPoint.p) }
    : null;

  return (
    <div className="charttab">
      <aside className="chart-rail">
        <div className="seg">
          <button className={list === 'watch' ? 'on' : ''} onClick={() => setList('watch')}>Watchlist</button>
          <button className={list === 'results' ? 'on' : ''} onClick={() => setList('results')}>Screen results</button>
        </div>
        {items.length === 0 && <p className="note">{list === 'watch' ? 'Your watchlist is empty. Star a stock to see it here.' : 'The Screener has no results.'}</p>}
        <ul>
          {items.map((r) => (
            <li key={r.s}>
              <button className={r.s === symbol ? 'on' : ''} onClick={() => onSymbol(r.s)}>
                <b>{r.s}</b>
                <span className="num">{fmtPrice(r.close)}</span>
                <Delta value={r.chg} />
              </button>
            </li>
          ))}
        </ul>
        <p className="keys"><kbd>↑</kbd><kbd>↓</kbd> next stock · <kbd>/</kbd> find any stock</p>
      </aside>

      <div className="chart-main">
        <div className="chart-bar">
          <div className="chart-title">
            <button className={`star ${watchlist[symbol] ? 'on' : ''}`} onClick={() => onToggleWatch(symbol)} aria-pressed={!!watchlist[symbol]} aria-label="Watchlist">{watchlist[symbol] ? '★' : '☆'}</button>
            <b>{symbol}</b>
            <span className="muted">{row?.name}</span>
          </div>
          <div className="seg" role="group" aria-label="Bar length">
            {(['D', 'W', 'M'] as const).map((t) => (
              <button key={t} className={settings.tf === t ? 'on' : ''} onClick={() => update({ tf: t })} title={{ D: 'Daily bars', W: 'Weekly bars', M: 'Monthly bars' }[t]}>{t}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Chart style">
            {([['candles', 'Candles'], ['line', 'Line'], ['area', 'Area']] as const).map(([k, label]) => (
              <button key={k} className={settings.kind === k ? 'on' : ''} onClick={() => update({ kind: k })}>{label}</button>
            ))}
          </div>
          <div className="menu-wrap">
            <button onClick={() => setMenu((m) => !m)} aria-expanded={menu}>Indicators <small>{Object.values(settings.ind).filter(Boolean).length}</small></button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                <span className="lbl">On the price</span>
                {INDICATORS.filter((i) => !i.pane).map((i) => (
                  <label key={i.id} title={i.hint}><input type="checkbox" checked={!!settings.ind[i.id]} onChange={(e) => update({ ind: { ...settings.ind, [i.id]: e.target.checked } })} /> {i.label}</label>
                ))}
                <span className="lbl">In their own panel</span>
                {INDICATORS.filter((i) => i.pane).map((i) => (
                  <label key={i.id} title={i.hint} className={i.id === 'oi' && !hist?.oi ? 'off' : ''}>
                    <input type="checkbox" disabled={i.id === 'oi' && !hist?.oi} checked={!!settings.ind[i.id]} onChange={(e) => update({ ind: { ...settings.ind, [i.id]: e.target.checked } })} /> {i.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <select value={compare} onChange={(e) => setCompare(e.target.value)} aria-label="Compare with" title="Overlay another series; the scale switches to percentage change">
            <option value="">Compare…</option>
            <optgroup label="Indices">{Object.keys(indices).filter((n) => n !== 'India VIX').map((n) => <option key={n}>{n}</option>)}</optgroup>
            <optgroup label={list === 'watch' ? 'Watchlist' : 'Screen results'}>{items.filter((r) => r.s !== symbol).slice(0, 40).map((r) => <option key={r.s}>{r.s}</option>)}</optgroup>
          </select>
          <label className="check" title="Equal percentage moves take equal height"><input type="checkbox" checked={settings.log} disabled={!!compare} onChange={(e) => update({ log: e.target.checked })} /> Log</label>
          <div className="tools" role="group" aria-label="Drawing tools">
            <button className={tool === 'h' ? 'on' : ''} onClick={() => { setTool(tool === 'h' ? 'none' : 'h'); setPendingPoint(null); }} title="Horizontal line: click a price on the chart">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg> Level
            </button>
            <button className={tool === 't' ? 'on' : ''} onClick={() => { setTool(tool === 't' ? 'none' : 't'); setPendingPoint(null); }} title="Trendline: click two points on the chart">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M2.5 12.5l11-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="2.5" cy="12.5" r="1.6" fill="currentColor" /><circle cx="13.5" cy="3.5" r="1.6" fill="currentColor" /></svg> Trendline
            </button>
            {mine.length > 0 && (
              <button className="plain" onClick={() => window.confirm(`Remove all ${mine.length} drawings on ${symbol}?`) && onSaveDrawings((prev) => ({ ...prev, [symbol]: [] }))} title="Remove every drawing on this chart">
                Clear <small>{mine.length}</small>
              </button>
            )}
          </div>
        </div>

        <div className="chart-stage">
          {failed && <div className="chart-empty">No price history for {symbol}.</div>}
          {!failed && !hist && <div className="chart-empty">Loading chart…</div>}
          <div className="lw" ref={holder} />
          {shown && (
            <div className="chart-legend">
              <span className="muted">{fmtDate(shown.date)}</span>
              <span>O <b>{fmtPrice(shown.o)}</b></span>
              <span>H <b>{fmtPrice(shown.h)}</b></span>
              <span>L <b>{fmtPrice(shown.l)}</b></span>
              <span>C <b>{fmtPrice(shown.c)}</b></span>
              {before && <span className={tone(shown.c - before.c)}>{fmtPct((shown.c / before.c - 1) * 100, 2)}</span>}
              <span className="muted">Vol {fmtQty(shown.v)}</span>
              {shown.dl != null && <span className="muted">Deliv {shown.dl.toFixed(0)}%</span>}
              {row?.bm?.results && <span className="tag">Results {fmtDate(row.bm.date, false)}</span>}
              {compare && <span className="tag">vs {compare} · % change from the left edge</span>}
            </div>
          )}
          <svg
            className={`draw ${tool !== 'none' ? 'active' : ''}`}
            width={geo.w}
            height={geo.h}
            onPointerDown={tool !== 'none' ? place : undefined}
            onPointerMove={tool !== 'none' ? (e) => { const p = pointAt(e); if (p) setCursor({ x: p.px, y: p.py }); } : undefined}
            onPointerLeave={() => setCursor(null)}
          >
            {geo.shapes.map((s) => (
              <rect key={s.code} className="shape" x={s.x} y={s.y} width={s.w} height={s.h} />
            ))}
            {geo.lines.map((ln) => (
              <g key={ln.id} className={`ln ${ln.id === selectedLine ? 'sel' : ''}`} onPointerDown={(e) => { if (tool === 'none') { e.stopPropagation(); setSelectedLine(ln.id === selectedLine ? null : ln.id); } }}>
                <line className="hit" x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} />
                <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} />
                {ln.type === 't' && ln.id === selectedLine && <><circle cx={ln.x1} cy={ln.y1} r={4} /><circle cx={ln.x2} cy={ln.y2} r={4} /></>}
              </g>
            ))}
            {tool === 'h' && cursor && <line className="preview" x1={0} x2={geo.w} y1={cursor.y} y2={cursor.y} />}
            {tool === 't' && pendingGeo?.x != null && pendingGeo.y != null && cursor && <line className="preview" x1={pendingGeo.x} y1={pendingGeo.y} x2={cursor.x} y2={cursor.y} />}
          </svg>
          {tool !== 'none' && (
            <div className="draw-hint">{tool === 'h' ? 'Click a price to place a level' : pendingPoint ? 'Click the second point' : 'Click the first point'} · Esc to cancel</div>
          )}
          {picked && (
            <div className="draw-actions">
              <span>{picked.type === 'h' ? `Level at ₹${fmtPrice(picked.p1)}` : 'Trendline'}</span>
              {picked.type === 'h' && <button onClick={() => { onSetLevel(symbol, picked.p1); setSelectedLine(null); }} title="The evening brief will tell you when the price closes across it">Use as my alert level</button>}
              <button onClick={() => removeLine(picked.id)}><Icon name="close" size={12} /> Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
