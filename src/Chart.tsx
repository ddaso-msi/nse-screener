import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtPrice, fmtQty, monthOf, type History } from './data';

const RANGES = [
  { id: '3M', n: 63 },
  { id: '6M', n: 126 },
  { id: '1Y', n: 252 },
  { id: 'All', n: Infinity },
] as const;

function sma(c: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    sum += c[i];
    if (i >= n) sum -= c[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

function niceTicks(min: number, max: number, count: number) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
  return ticks;
}

const PAD = { l: 8, r: 56, t: 10 };
const PRICE_H = 230;
const GAP = 22;
const VOL_H = 56;
const AXIS_H = 20;
const H = PAD.t + PRICE_H + GAP + VOL_H + AXIS_H;

export function Chart({ hist }: { hist: History }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('1Y');
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(560);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const s50 = useMemo(() => sma(hist.c, 50), [hist]);
  const s200 = useMemo(() => sma(hist.c, 200), [hist]);

  const total = hist.c.length;
  const n = Math.min(total, RANGES.find((r) => r.id === range)!.n);
  const start = total - n;
  const idx = Array.from({ length: n }, (_, i) => start + i);

  const vals = idx.flatMap((i) => [hist.c[i], s50[i], s200[i]]).filter((v): v is number => v != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const padY = (hi - lo) * 0.06 || hi * 0.02;
  const yMin = lo - padY;
  const yMax = hi + padY;
  const vMax = Math.max(...idx.map((i) => hist.v[i]), 1);

  const plotW = width - PAD.l - PAD.r;
  const x = (k: number) => PAD.l + (n === 1 ? plotW / 2 : (k / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + PRICE_H - ((v - yMin) / (yMax - yMin)) * PRICE_H;
  const volTop = PAD.t + PRICE_H + GAP;

  const path = (series: (number | null)[]) => {
    let d = '';
    let pen = false;
    idx.forEach((i, k) => {
      const v = series[i];
      if (v == null) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const monthTicks = idx
    .map((i, k) => ({ i, k }))
    .filter(({ i, k }) => k > 0 && Math.floor(hist.d[i] / 100) !== Math.floor(hist.d[i - 1] / 100));
  const every = Math.ceil(monthTicks.length / Math.max(2, Math.floor(plotW / 70)));
  const barW = Math.max(1, Math.min(6, plotW / n - 1));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const k = Math.round(((e.clientX - box.left - PAD.l) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, k)));
  };

  const hk = hover != null && hover < n ? hover : null;
  const hi_ = hk != null ? idx[hk] : null;
  const prevClose = hi_ != null && hi_ > 0 ? hist.c[hi_ - 1] : null;
  const dayChg = hi_ != null && prevClose ? (hist.c[hi_] / prevClose - 1) * 100 : null;
  const first = hist.c[start];
  const last = hist.c[total - 1];
  const periodChg = (last / first - 1) * 100;

  const series = [
    { label: 'Close', cls: 'c-price', has: true },
    { label: '50 DMA', cls: 'c-sma50', has: idx.some((i) => s50[i] != null) },
    { label: '200 DMA', cls: 'c-sma200', has: idx.some((i) => s200[i] != null) },
  ].filter((s) => s.has);

  return (
    <div className="chart">
      <div className="chart-head">
        <div className="legend">
          {series.map((s) => (
            <span key={s.label}>
              <i className={s.cls} />
              {s.label}
            </span>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button key={r.id} className={r.id === range ? 'on' : ''} onClick={() => setRange(r.id)}>
              {r.id}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-sub">
        {fmtDate(hist.d[start])} – {fmtDate(hist.d[total - 1])}
        <b className={periodChg >= 0 ? 'up' : 'down'}>
          {periodChg >= 0 ? '▲' : '▼'} {Math.abs(periodChg).toFixed(1)}%
        </b>
      </div>
      <div className="chart-plot" ref={wrap}>
        <svg
          width={width}
          height={H}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label="Price and volume history"
        >
          {niceTicks(yMin, yMax, 4).map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.l + plotW + 6} y={y(t) + 3.5}>
                {t >= 1000 ? Math.round(t).toLocaleString('en-IN') : +t.toFixed(2)}
              </text>
            </g>
          ))}
          {monthTicks
            .filter((_, j) => j % every === 0)
            .map(({ i, k }) => (
              <text key={i} className="tick" x={x(k)} y={H - 5} textAnchor="middle">
                {monthOf(hist.d[i])}
                {Math.floor(hist.d[i] / 100) % 100 === 1 ? ` ’${String(Math.floor(hist.d[i] / 10000)).slice(2)}` : ''}
              </text>
            ))}
          <text className="tick" x={PAD.l} y={volTop - 6}>
            Volume
          </text>
          <line className="axis" x1={PAD.l} x2={PAD.l + plotW} y1={volTop + VOL_H} y2={volTop + VOL_H} />
          {idx.map((i, k) => {
            const h = Math.max(1, (hist.v[i] / vMax) * VOL_H);
            return (
              <rect
                key={i}
                className={k === hk ? 'vol on' : 'vol'}
                x={x(k) - barW / 2}
                y={volTop + VOL_H - h}
                width={barW}
                height={h}
              />
            );
          })}
          <path className="line s-sma200" d={path(s200)} />
          <path className="line s-sma50" d={path(s50)} />
          <path className="line s-price" d={path(hist.c)} />
          {hk != null && hi_ != null && (
            <g>
              <line className="cross" x1={x(hk)} x2={x(hk)} y1={PAD.t} y2={volTop + VOL_H} />
              <circle className="dot" cx={x(hk)} cy={y(hist.c[hi_])} r={4} />
            </g>
          )}
        </svg>
        {hk != null && hi_ != null && (
          <div className="tip" style={x(hk) > width / 2 ? { left: 8 } : { right: PAD.r + 4 }}>
            <div className="tip-date">{fmtDate(hist.d[hi_])}</div>
            <dl>
              <dt><i className="c-price" />Close</dt>
              <dd>
                {fmtPrice(hist.c[hi_])}
                {dayChg != null && (
                  <span className={dayChg >= 0 ? 'up' : 'down'}> {dayChg >= 0 ? '+' : '−'}{Math.abs(dayChg).toFixed(2)}%</span>
                )}
              </dd>
              <dt>O / H / L</dt>
              <dd>{fmtPrice(hist.o[hi_])} / {fmtPrice(hist.h[hi_])} / {fmtPrice(hist.l[hi_])}</dd>
              {s50[hi_] != null && (<><dt><i className="c-sma50" />50 DMA</dt><dd>{fmtPrice(s50[hi_])}</dd></>)}
              {s200[hi_] != null && (<><dt><i className="c-sma200" />200 DMA</dt><dd>{fmtPrice(s200[hi_])}</dd></>)}
              <dt>Volume</dt>
              <dd>{fmtQty(hist.v[hi_])}</dd>
              {hist.dl[hi_] != null && (<><dt>Delivery</dt><dd>{hist.dl[hi_]!.toFixed(1)}%</dd></>)}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
