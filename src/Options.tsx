import { useEffect, useMemo, useRef, useState } from 'react';
import { fileSafe, fmtDate, fmtPct, fmtPrice } from './data';
import { TEMPLATES, analyse, type Chain, type Expiry, type Leg, type OptionHead, type Position, type StrikeRow } from './optionMath';
import { Delta, Icon, tone } from './ui';
import { Explain } from './Help';

const NEAR = 10; // strikes shown either side of the money before "Show all"

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const compact = (v: number) => (Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(1)} L` : int.format(v));
const rupees = (v: number | null) => (v == null ? 'Unlimited' : `${v < 0 ? '−' : v > 0 ? '+' : ''}₹${int.format(Math.abs(Math.round(v)))}`);
const signed = (v: number, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })}`;

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function ticks(min: number, max: number, count: number) {
  const raw = (max - min || 1) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(t);
  return out;
}

/** Profit or loss across underlying prices: at expiry, and on a chosen earlier day. */
function Payoff({ pos, spot, exp, daysAhead }: { pos: Position; spot: number; exp: Expiry; daysAhead: number }) {
  const [wrap, width] = useWidth<HTMLDivElement>(520);
  const [hover, setHover] = useState<number | null>(null);
  const H = 260, PAD = { l: 8, r: 62, t: 14, b: 22 };
  const plotW = width - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

  const sigma = ((exp.atmIv ?? 25) / 100) * Math.sqrt(Math.max(exp.days, 1) / 365);
  const reach = Math.max(0.06, Math.min(0.6, sigma * 3));
  const far = Math.max(reach, ...pos.breakevens.map((b) => Math.abs(b / spot - 1) * 1.25).filter((d) => d < 0.9));
  const x0 = spot * (1 - far), x1 = spot * (1 + far);
  const N = 120;
  const xs = Array.from({ length: N + 1 }, (_, i) => x0 + ((x1 - x0) * i) / N);
  const atExp = xs.map(pos.atExpiry);
  const early = exp.days - daysAhead > 0;
  const onDay = early ? xs.map((x) => pos.onDay(x, daysAhead)) : atExp;
  const lo = Math.min(0, ...atExp, ...onDay), hi = Math.max(0, ...atExp, ...onDay);
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const x = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * plotW;
  const y = (v: number) => PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line(atExp)}L${x(x1).toFixed(1)},${y(0).toFixed(1)}L${x(x0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const hk = hover != null ? hover : null;

  return (
    <div className="chart payoff">
      <div className="legend">
        <span><i className="c-price" />At expiry ({fmtDate(exp.date, false)})</span>
        {early && <span><i className="c-sma50" />{daysAhead === 0 ? 'Today' : `In ${daysAhead} day${daysAhead === 1 ? '' : 's'}`}</span>}
      </div>
      <div className="chart-plot" ref={wrap}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Profit or loss of the position across underlying prices"
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(N, Math.round(((e.clientX - box.left - PAD.l) / plotW) * N))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id="gain"><rect x={PAD.l} y={PAD.t} width={plotW} height={Math.max(0, y(0) - PAD.t)} /></clipPath>
            <clipPath id="loss"><rect x={PAD.l} y={y(0)} width={plotW} height={Math.max(0, PAD.t + plotH - y(0))} /></clipPath>
          </defs>
          {ticks(yMin, yMax, 4).map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.l + plotW + 6} y={y(t) + 3.5}>{t === 0 ? '0' : compact(t)}</text>
            </g>
          ))}
          {ticks(x0, x1, Math.max(3, Math.floor(plotW / 90))).map((t) => (
            <text key={t} className="tick" x={x(t)} y={H - 6} textAnchor="middle">{int.format(t)}</text>
          ))}
          <path d={area} className="fill-up" clipPath="url(#gain)" />
          <path d={area} className="fill-down" clipPath="url(#loss)" />
          <line className="axis zero" x1={PAD.l} x2={PAD.l + plotW} y1={y(0)} y2={y(0)} />
          <line className="cross" x1={x(spot)} x2={x(spot)} y1={PAD.t} y2={PAD.t + plotH} />
          <text className="tick" x={x(spot)} y={PAD.t - 3} textAnchor="middle">now {int.format(spot)}</text>
          {early && <path className="line s-sma50" d={line(onDay)} />}
          <path className="line s-price" d={line(atExp)} />
          {pos.breakevens.filter((b) => b > x0 && b < x1).map((b) => (
            <circle key={b} className="be" cx={x(b)} cy={y(0)} r={4}><title>Breakeven {int.format(b)}</title></circle>
          ))}
          {hk != null && (
            <g>
              <line className="cross solid" x1={x(xs[hk])} x2={x(xs[hk])} y1={PAD.t} y2={PAD.t + plotH} />
              {early && <circle className="dot d-sma50" cx={x(xs[hk])} cy={y(onDay[hk])} r={4} />}
              <circle className="dot" cx={x(xs[hk])} cy={y(atExp[hk])} r={4} />
            </g>
          )}
        </svg>
        {hk != null && (
          <div className="tip" style={x(xs[hk]) > width / 2 ? { left: 8 } : { right: PAD.r + 4 }}>
            <div className="tip-date">{int.format(xs[hk])} <span className="muted">({fmtPct((xs[hk] / spot - 1) * 100)})</span></div>
            <dl>
              <dt><i className="c-price" />At expiry</dt><dd className={tone(atExp[hk])}>{rupees(atExp[hk])}</dd>
              {early && <><dt><i className="c-sma50" />{daysAhead === 0 ? 'Today' : `In ${daysAhead}d`}</dt><dd className={tone(onDay[hk])}>{rupees(onDay[hk])}</dd></>}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

/** Call and put open interest by strike, side by side. */
function OiChart({ rows, atm, mode }: { rows: StrikeRow[]; atm: number; mode: 'oi' | 'chg' }) {
  const [wrap, width] = useWidth<HTMLDivElement>(700);
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, PAD = { l: 8, r: 54, t: 12, b: 22 };
  const plotW = width - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const c = (r: StrikeRow) => (mode === 'oi' ? r[2] : r[3]);
  const p = (r: StrikeRow) => (mode === 'oi' ? r[7] : r[8]);
  const hi = Math.max(1, ...rows.flatMap((r) => [c(r), p(r)]));
  const lo = Math.min(0, ...rows.flatMap((r) => [c(r), p(r)]));
  const y = (v: number) => PAD.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const band = plotW / rows.length;
  const bar = Math.max(2, Math.min(14, (band - 6) / 2));
  const every = Math.ceil(rows.length / Math.max(4, Math.floor(plotW / 56)));
  const rect = (v: number, left: number, cls: string) => {
    const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
    return <rect className={cls} x={left} y={top} width={bar} height={h} rx={Math.min(3, bar / 2)} />;
  };
  return (
    <div className="chart">
      <div className="legend">
        <span><i className="c-price sq" />Calls</span>
        <span><i className="c-sma50 sq" />Puts</span>
      </div>
      <div className="chart-plot" ref={wrap}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={`Call and put ${mode === 'oi' ? 'open interest' : 'change in open interest'} by strike`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientX - box.left - PAD.l) / band))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks(lo, hi, 3).map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'axis' : 'grid'} x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.l + plotW + 6} y={y(t) + 3.5}>{t === 0 ? '0' : compact(t)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const mid = PAD.l + band * (i + 0.5);
            return (
              <g key={r[0]} className={hover != null && hover !== i ? 'dim' : ''}>
                {r[0] === atm && <rect className="atm-band" x={PAD.l + band * i} y={PAD.t} width={band} height={plotH} />}
                {rect(c(r), mid - bar - 1, 'b-call')}
                {rect(p(r), mid + 1, 'b-put')}
                {i % every === 0 && <text className="tick" x={mid} y={H - 6} textAnchor="middle">{int.format(r[0])}</text>}
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div className="tip" style={hover > rows.length / 2 ? { left: 8 } : { right: PAD.r + 4 }}>
            <div className="tip-date">Strike {int.format(rows[hover][0])}{rows[hover][0] === atm && <span className="muted"> · at the money</span>}</div>
            <dl>
              <dt><i className="c-price sq" />Call OI</dt><dd>{compact(rows[hover][2])} <span className={tone(rows[hover][3])}>({signed(rows[hover][3])})</span></dd>
              <dt><i className="c-sma50 sq" />Put OI</dt><dd>{compact(rows[hover][7])} <span className={tone(rows[hover][8])}>({signed(rows[hover][8])})</span></dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

export function Options() {
  const [index, setIndex] = useState<{ asOf: number; rate: number; list: OptionHead[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [symbol, setSymbol] = useState('NIFTY');
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiryDate, setExpiryDate] = useState<number | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [template, setTemplate] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [daysAhead, setDaysAhead] = useState(0);
  const [oiMode, setOiMode] = useState<'oi' | 'chg'>('oi');
  const nextId = useRef(1);

  useEffect(() => {
    fetch(`/data/options.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setIndex)
      .catch(() => setMissing(true));
  }, []);

  useEffect(() => {
    if (!index) return;
    let live = true;
    setChain(null);
    fetch(`/data/o/${fileSafe(symbol)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((c: Chain) => {
        if (!live) return;
        setChain(c);
        // start on the first expiry that isn't about to lapse
        setExpiryDate((c.expiries.find((e) => e.days >= 2) ?? c.expiries[0]).date);
        setLegs([]);
        setTemplate(null);
        setDaysAhead(0);
      })
      .catch(() => live && setMissing(true));
    return () => void (live = false);
  }, [symbol, index]);

  const exp = useMemo(() => chain?.expiries.find((e) => e.date === expiryDate) ?? null, [chain, expiryDate]);
  const priced = useMemo(() => exp?.strikes.filter((r) => r[1] != null || r[6] != null) ?? [], [exp]);
  const atm = useMemo(
    () => (chain && priced.length ? priced.reduce((b, r) => (Math.abs(r[0] - chain.spot) < Math.abs(b - chain.spot) ? r[0] : b), priced[0][0]) : 0),
    [chain, priced],
  );
  const lot = chain?.lot ?? 1;
  const pos = useMemo(() => (chain && exp && legs.length ? analyse(legs, chain.spot, exp, lot, index?.rate ?? 0.065) : null), [legs, chain, exp, lot, index]);

  if (missing) return <div className="bt empty-app"><p>No option chain is available yet. It is collected with each data refresh, once NSE has published the day's derivatives file.</p></div>;
  if (!index || !chain || !exp) return <div className="bt" />;

  const atmAt = priced.findIndex((r) => r[0] === atm);
  const visible = showAll ? priced : priced.slice(Math.max(0, atmAt - NEAR), atmAt + NEAR + 1);
  const maxOi = Math.max(1, ...visible.flatMap((r) => [r[2], r[7]]));
  const width = chain.spot * ((exp.atmIv ?? 20) / 100) * Math.sqrt(Math.max(exp.days, 1) / 365);

  const add = (r: StrikeRow, kind: 'C' | 'P', side: 1 | -1) => {
    const price = kind === 'C' ? r[1] : r[6];
    if (price == null) return;
    setTemplate(null);
    setLegs((ls) => [...ls, { id: nextId.current++, kind, side, strike: r[0], lots: 1, price, iv: (kind === 'C' ? r[5] : r[10]) ?? exp.atmIv ?? 20 }]);
  };
  const useTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    const both = priced.filter((r) => r[1] != null && r[6] != null);
    if (!both.length) return;
    setTemplate(id);
    setLegs(t.legs(both, atm, width).map((l) => ({ ...l, id: nextId.current++, lots: 1 })));
  };
  const edit = (id: number, patch: Partial<Leg>) => {
    setTemplate(null);
    setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const pickExpiry = (date: number) => {
    setExpiryDate(date);
    setLegs([]);
    setTemplate(null);
    setDaysAhead(0);
  };
  const inLegs = (k: number, kind: 'C' | 'P') => legs.find((l) => l.strike === k && l.kind === kind);

  const side = (r: StrikeRow, kind: 'C' | 'P') => {
    const call = kind === 'C';
    const price = call ? r[1] : r[6];
    const oi = call ? r[2] : r[7], chg = call ? r[3] : r[8], iv = call ? r[5] : r[10];
    const itm = call ? r[0] < chain.spot : r[0] > chain.spot;
    const held = inLegs(r[0], kind);
    const cells = [
      <td key="oi" className={`oi ${itm ? 'itm' : ''}`}>
        <i className={call ? 'b-call' : 'b-put'} style={{ width: `${(oi / maxOi) * 100}%` }} />
        <span>{oi ? compact(oi) : '–'}</span>
      </td>,
      <td key="chg" className={`${itm ? 'itm' : ''} ${tone(chg)}`}>{chg ? signed(chg) : '–'}</td>,
      <td key="iv" className={itm ? 'itm' : ''}>{iv == null ? '–' : iv.toFixed(1)}</td>,
      <td key="px" className={`px ${itm ? 'itm' : ''} ${held ? (held.side > 0 ? 'bought' : 'sold') : ''}`}>
        {price == null ? '–' : (
          <>
            <span>{fmtPrice(price)}</span>
            <span className="bs">
              <button className="b" onClick={() => add(r, kind, 1)} aria-label={`Buy ${r[0]} ${call ? 'call' : 'put'}`}>B</button>
              <button className="s" onClick={() => add(r, kind, -1)} aria-label={`Sell ${r[0]} ${call ? 'call' : 'put'}`}>S</button>
            </span>
          </>
        )}
      </td>,
    ];
    return call ? cells : cells.reverse();
  };

  return (
    <div className="bt options">
      <div className="bt-head first">
        <div>
          <h2>Options</h2>
          <p>End-of-day chain as of {fmtDate(chain.asOf)} · settlement prices, not live quotes</p>
        </div>
        <label className="picker">
          <span className="lbl">Underlying</span>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <optgroup label="Indices">
              {index.list.filter((u) => u.index).map((u) => <option key={u.s} value={u.s}>{u.name}</option>)}
            </optgroup>
            <optgroup label="Stocks, most open interest first">
              {index.list.filter((u) => !u.index).map((u) => <option key={u.s} value={u.s}>{u.s} · {u.name}</option>)}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="tiles">
        <div className="tile"><span>{chain.name}</span><b className="row">{fmtPrice(chain.spot)} <Delta value={chain.chg} /></b><small>Lot size {chain.lot ? int.format(chain.lot) : '–'}</small></div>
        <div className="tile" title="Volatility implied by at-the-money option prices for this expiry">
          <span>Implied volatility <Explain term="ivRank" /></span><b>{exp.atmIv == null ? '–' : `${exp.atmIv.toFixed(1)}%`}</b>
          <small>{chain.ivRank == null ? 'Not enough history for a rank' : `Higher than ${chain.ivRank.toFixed(0)}% of the past year`}</small>
        </div>
        <div className="tile" title="One standard deviation, from implied volatility">
          <span>Move priced in by expiry</span><b>±{int.format(width)}</b><small>±{((width / chain.spot) * 100).toFixed(1)}% in {exp.days} day{exp.days === 1 ? '' : 's'}</small>
        </div>
        <div className="tile"><span>Put/call ratio <Explain term="pcr" /></span><b>{exp.pcr?.toFixed(2) ?? '–'}</b><small>{compact(exp.putOi)} puts / {compact(exp.callOi)} calls</small></div>
        <div className="tile" title="The expiry price at which option buyers, in total, are paid the least"><span>Max pain <Explain term="maxPain" /></span><b>{exp.maxPain ? int.format(exp.maxPain) : '–'}</b><small>{exp.maxPain ? fmtPct((exp.maxPain / chain.spot - 1) * 100) : ''} from the price</small></div>
      </div>

      <div className="expiries" role="group" aria-label="Expiry">
        {chain.expiries.slice(0, 8).map((e) => (
          <button key={e.date} className={e.date === exp.date ? 'on' : ''} onClick={() => pickExpiry(e.date)}>
            {fmtDate(e.date, false)} <small>{e.days}d</small>
          </button>
        ))}
        {chain.expiries.length > 8 && (
          <select value={chain.expiries.slice(8).some((e) => e.date === exp.date) ? exp.date : ''} onChange={(e) => e.target.value && pickExpiry(Number(e.target.value))} aria-label="Later expiries">
            <option value="">Later…</option>
            {chain.expiries.slice(8).map((e) => <option key={e.date} value={e.date}>{fmtDate(e.date)}</option>)}
          </select>
        )}
      </div>

      <div className="opt-grid">
        <section className="panel chain">
          <div className="screen-head">
            <h3>Option chain <small>{visible.length} of {priced.length} strikes</small></h3>
            <button className="link" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Near the money only' : 'Show all strikes'}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr className="sides"><th colSpan={4}>Calls</th><th /><th colSpan={4}>Puts</th></tr>
                <tr>
                  <th title="Open interest">OI</th><th title="Change in open interest today">Chg</th><th title="Implied volatility, %">IV</th><th>Price</th>
                  <th className="strike">Strike</th>
                  <th>Price</th><th title="Implied volatility, %">IV</th><th title="Change in open interest today">Chg</th><th title="Open interest">OI</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r[0]} className={`static ${r[0] === atm ? 'atm' : ''}`}>
                    {side(r, 'C')}
                    <td className="strike">{int.format(r[0])}</td>
                    {side(r, 'P')}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Hover a price and press B to buy or S to sell that option in the builder. Shaded cells are in the money.</p>
        </section>

        <section className="panel builder">
          <h3>Strategy builder <small>{fmtDate(exp.date, false)} expiry</small></h3>
          <div className="templates">
            {TEMPLATES.map((t) => (
              <button key={t.id} className={template === t.id ? 'on' : ''} onClick={() => useTemplate(t.id)} title={t.hint}>{t.label}</button>
            ))}
          </div>
          {template && <p className="note">{TEMPLATES.find((t) => t.id === template)!.hint}</p>}

          {legs.length === 0 ? (
            <div className="none small">
              <Icon name="backtest" size={24} />
              <p>Pick a structure above, or add options from the chain, to see what the position makes or loses at each price.</p>
            </div>
          ) : (
            <>
              <ul className="legs">
                {legs.map((l) => (
                  <li key={l.id}>
                    <button className={`sidebtn ${l.side > 0 ? 'b' : 's'}`} onClick={() => edit(l.id, { side: l.side > 0 ? -1 : 1 })} title="Switch between buy and sell">
                      {l.side > 0 ? 'Buy' : 'Sell'}
                    </button>
                    <span className="stepper">
                      <button onClick={() => edit(l.id, { lots: Math.max(1, l.lots - 1) })} aria-label="Fewer lots">−</button>
                      <b>{l.lots}</b>
                      <button onClick={() => edit(l.id, { lots: l.lots + 1 })} aria-label="More lots">+</button>
                    </span>
                    <span className="what">{int.format(l.strike)} {l.kind === 'C' ? 'call' : 'put'}</span>
                    <span className="muted">@ {fmtPrice(l.price)}</span>
                    <button className="icon" onClick={() => { setTemplate(null); setLegs((ls) => ls.filter((x) => x.id !== l.id)); }} aria-label="Remove leg">✕</button>
                  </li>
                ))}
              </ul>

              {pos && (
                <>
                  <div className="stats outcome">
                    <div className="stat"><span>Max profit</span><b className="up">{rupees(pos.maxProfit)}</b></div>
                    <div className="stat"><span>Max loss</span><b className="down">{rupees(pos.maxLoss)}</b></div>
                    <div className="stat"><span>{pos.premium >= 0 ? 'You pay' : 'You receive'}</span><b>₹{int.format(Math.abs(Math.round(pos.premium)))}</b></div>
                    <div className="stat"><span>Breakeven{pos.breakevens.length === 1 ? '' : 's'}</span><b>{pos.breakevens.length ? pos.breakevens.map((b) => int.format(b)).join(' · ') : '–'}</b></div>
                    <div className="stat" title="Chance of any profit at expiry if prices follow the at-the-money implied volatility. A model figure, not a forecast."><span>Chance of profit (model)</span><b>{pos.pop == null ? '–' : `${pos.pop.toFixed(0)}%`}</b></div>
                    <div className="stat" title="How much the position gains or loses each day from time passing, all else equal"><span>Time decay per day</span><b className={tone(pos.net.theta)}>{rupees(pos.net.theta)}</b></div>
                    <div className="stat" title="Delta: P&L for a 1-point move in the underlying"><span>Per 1-point move</span><b className={tone(pos.net.delta)}>{rupees(pos.net.delta)}</b></div>
                    <div className="stat" title="Vega: P&L if implied volatility rises one point"><span>Per 1-point rise in IV</span><b className={tone(pos.net.vega)}>{rupees(pos.net.vega)}</b></div>
                  </div>
                  <Payoff pos={pos} spot={chain.spot} exp={exp} daysAhead={daysAhead} />
                  {exp.days > 1 && (
                    <label className="slider">
                      <span>Show P&L {daysAhead === 0 ? 'today' : `${daysAhead} day${daysAhead === 1 ? '' : 's'} from now`}</span>
                      <input type="range" min={0} max={exp.days} value={daysAhead} onChange={(e) => setDaysAhead(Number(e.target.value))} />
                    </label>
                  )}
                  <button className="link first" onClick={() => { setLegs([]); setTemplate(null); }}>Clear position</button>
                </>
              )}
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="screen-head">
          <h3>Open interest by strike <small>{fmtDate(exp.date, false)} expiry</small></h3>
          <div className="seg small">
            <button className={oiMode === 'oi' ? 'on' : ''} onClick={() => setOiMode('oi')}>Open interest</button>
            <button className={oiMode === 'chg' ? 'on' : ''} onClick={() => setOiMode('chg')}>Today's change</button>
          </div>
        </div>
        <OiChart rows={visible} atm={atm} mode={oiMode} />
      </section>

      <p className="note disclaimer">
        Figures use end-of-day settlement prices, one lot of {chain.lot ? int.format(chain.lot) : '–'} per leg, and a 6.5% interest rate. Margin, brokerage, taxes and early exits are not modelled, and actual fills will differ. Selling options can lose far more than the premium received. This shows how a position behaves; it does not recommend one.
      </p>
    </div>
  );
}
