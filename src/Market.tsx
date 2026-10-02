import { useEffect, useRef, useState } from 'react';
import { fmtDate, fmtPct, monthOf } from './data';
import { Delta, Spark, tone } from './ui';

interface Summary {
  n: number;
  chg: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
  above50: number | null;
  above200: number | null;
}
export interface MarketData {
  liquid: number;
  above50: number | null;
  above200: number | null;
  above50MonthAgo: number | null;
  above200MonthAgo: number | null;
  newHi: number;
  newLo: number;
  advancers: number;
  decliners: number;
  medianChg: number | null;
  groups: (Summary & { label: string })[];
  sectors: (Summary & { sector: string })[];
  history: { d: number[]; a50: (number | null)[]; a200: (number | null)[]; hi: number[]; lo: number[] };
  deriv?: Positioning | null;
}
interface Positioning {
  indices: {
    symbol: string; name: string; close: number; chg: number | null; pe: number | null;
    futOiChg: number | null; pcr: number | null; expiry: number | null; maxPain: number | null;
    resistance: number | null; support: number | null; iv: number | null;
  }[];
  vix: { close: number; chg: number } | null;
  participants: { who: string; net: number; longShare: number; netChg: number | null }[] | null;
  ban: string[];
}

const WHO: Record<string, string> = { FII: 'Foreign institutions', Client: 'Retail and other clients', Pro: 'Proprietary desks', DII: 'Domestic institutions' };
const n0 = (v: number | null | undefined) => (v == null ? '–' : Math.round(v).toLocaleString('en-IN'));

/** Index futures and options positioning: where the option open interest sits, and who is long or short. */
function IndexPositioning({ deriv }: { deriv: Positioning }) {
  return (
    <section className="positioning" id="positioning">
      <h3>Index futures and options <small>end-of-day positioning</small></h3>
      <div className="pos-grid">
        {deriv.indices.slice().reverse().map((x) => {
          const lo = x.support, hi = x.resistance;
          const span = lo != null && hi != null && hi > lo ? hi - lo : null;
          const at = (v: number | null) => (span && v != null ? Math.max(0, Math.min(100, ((v - lo!) / span) * 100)) : null);
          return (
            <div className="tile pos" key={x.symbol}>
              <span>{x.name}</span>
              <b>{n0(x.close)} <Delta value={x.chg} /></b>
              {span && (
                <div className="walls" role="img" aria-label={`Price ${n0(x.close)} between put support at ${n0(lo)} and call resistance at ${n0(hi)}`}>
                  <div className="walls-track">
                    {at(x.maxPain) != null && <i className="pain" style={{ left: `${at(x.maxPain)}%` }} title={`Max pain ${n0(x.maxPain)}`} />}
                    <i className="spot" style={{ left: `${at(x.close)}%` }} title={`Close ${n0(x.close)}`} />
                  </div>
                  <div className="walls-labels">
                    <span><em>Put support</em>{n0(lo)}</span>
                    <span><em>Call resistance</em>{n0(hi)}</span>
                  </div>
                </div>
              )}
              <dl>
                <dt title="Put open interest divided by call open interest, all expiries">Put/call ratio</dt><dd>{x.pcr?.toFixed(2) ?? '–'}</dd>
                <dt title="The expiry price at which option buyers, in total, are paid the least">Max pain</dt><dd>{n0(x.maxPain)}</dd>
                <dt>Futures open interest</dt><dd className={tone(x.futOiChg)}>{fmtPct(x.futOiChg)}</dd>
                <dt>Implied volatility</dt><dd>{x.iv == null ? '–' : `${x.iv.toFixed(1)}%`}</dd>
                <dt>Nearest expiry</dt><dd>{x.expiry ? fmtDate(x.expiry, false) : '–'}</dd>
                {x.pe != null && <><dt>Index P/E</dt><dd>{x.pe.toFixed(1)}</dd></>}
              </dl>
            </div>
          );
        })}
        <div className="tile pos">
          <span>Who holds index futures</span>
          {deriv.vix && <b>VIX {deriv.vix.close.toFixed(2)} <Delta value={deriv.vix.chg} /></b>}
          {deriv.participants ? (
            <table className="who">
              <thead>
                <tr><th className="left">Participant</th><th title="Long contracts minus short contracts">Net</th><th title="Change in net position today">Today</th><th title="Share of their index futures that are long">Long</th></tr>
              </thead>
              <tbody>
                {deriv.participants.map((p) => (
                  <tr key={p.who} className="static">
                    <td className="left" title={WHO[p.who]}>{p.who === 'Client' ? 'Clients' : p.who}</td>
                    <td className={tone(p.net)}>{p.net > 0 ? '+' : p.net < 0 ? '−' : ''}{n0(Math.abs(p.net))}</td>
                    <td className={tone(p.netChg)}>{p.netChg == null ? '–' : `${p.netChg > 0 ? '+' : p.netChg < 0 ? '−' : ''}${n0(Math.abs(p.netChg))}`}</td>
                    <td><span className="meter">{p.longShare.toFixed(0)}%<i><b style={{ width: `${p.longShare}%` }} /></i></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <small>Participant data not published yet.</small>}
          <small>
            {deriv.ban.length ? <>F&O ban: {deriv.ban.join(', ')}</> : 'No stocks in the F&O ban period.'}
          </small>
        </div>
      </div>
      <p className="note">
        Put support and call resistance are the strikes with the most open interest below and above the price for the nearest expiry. They show where option writers are positioned, not where the price will go.
      </p>
    </section>
  );
}

const pc = (v: number | null) => (v == null ? '–' : `${v.toFixed(0)}%`);

const PAD = { l: 8, r: 40, t: 10, b: 20 };
const H = 190;

/** Share of liquid stocks above their 50- and 200-day averages, one shared 0-100% axis. */
function BreadthChart({ history }: { history: MarketData['history'] }) {
  const [width, setWidth] = useState(520);
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = history.d.length;
  const plotW = width - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (k: number) => PAD.l + (k / Math.max(1, n - 1)) * plotW;
  const y = (v: number) => PAD.t + plotH - (v / 100) * plotH;
  const path = (s: (number | null)[]) => {
    let d = '';
    let pen = false;
    s.forEach((v, k) => {
      if (v == null) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const months = history.d
    .map((d, k) => ({ d, k }))
    .filter(({ d, k }) => k > 0 && Math.floor(d / 100) !== Math.floor(history.d[k - 1] / 100));
  const every = Math.ceil(months.length / Math.max(2, Math.floor(plotW / 60)));
  const hk = hover != null && hover < n ? hover : null;

  return (
    <div className="chart">
      <div className="chart-head">
        <div className="legend">
          <span><i className="c-price" />Above 200-day average</span>
          <span><i className="c-sma50" />Above 50-day average</span>
        </div>
      </div>
      <div className="chart-plot" ref={wrap}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Share of liquid stocks above their 50- and 200-day averages over the past year"
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left - PAD.l) / plotW) * (n - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}>
              <line className={t === 50 ? 'axis' : 'grid'} x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.l + plotW + 6} y={y(t) + 3.5}>{t}%</text>
            </g>
          ))}
          {months.filter((_, j) => j % every === 0).map(({ d, k }) => (
            <text key={d} className="tick" x={x(k)} y={H - 5} textAnchor="middle">
              {monthOf(d)}{Math.floor(d / 100) % 100 === 1 ? ` ’${String(Math.floor(d / 10000)).slice(2)}` : ''}
            </text>
          ))}
          <path className="line s-sma50" d={path(history.a50)} />
          <path className="line s-price" d={path(history.a200)} />
          {hk != null && (
            <g>
              <line className="cross" x1={x(hk)} x2={x(hk)} y1={PAD.t} y2={PAD.t + plotH} />
              {history.a50[hk] != null && <circle className="dot d-sma50" cx={x(hk)} cy={y(history.a50[hk]!)} r={4} />}
              {history.a200[hk] != null && <circle className="dot" cx={x(hk)} cy={y(history.a200[hk]!)} r={4} />}
            </g>
          )}
        </svg>
        {hk != null && (
          <div className="tip" style={x(hk) > width / 2 ? { left: 8 } : { right: PAD.r + 4 }}>
            <div className="tip-date">{fmtDate(history.d[hk])}</div>
            <dl>
              <dt><i className="c-price" />Above 200-day</dt><dd>{pc(history.a200[hk])}</dd>
              <dt><i className="c-sma50" />Above 50-day</dt><dd>{pc(history.a50[hk])}</dd>
              <dt>New 52W highs</dt><dd>{history.hi[hk]}</dd>
              <dt>New 52W lows</dt><dd>{history.lo[hk]}</dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="tile">
      <span>{label}</span>
      <b>{value}</b>
      {children}
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Two counts as one bar split in proportion, e.g. advancers vs decliners. */
function Split({ up, down, upLabel, downLabel }: { up: number; down: number; upLabel: string; downLabel: string }) {
  const total = up + down || 1;
  return (
    <div className="split" role="img" aria-label={`${up} ${upLabel}, ${down} ${downLabel}`}>
      <i className="up" style={{ flexGrow: up / total }} title={`${up} ${upLabel}`} />
      <i className="down" style={{ flexGrow: down / total }} title={`${down} ${downLabel}`} />
    </div>
  );
}

/** The headline breadth reading: today's share above the 200-day average, with last month's marked. */
export function BreadthMeter({ market }: { market: MarketData }) {
  const now = market.above200;
  const then = market.above200MonthAgo;
  return (
    <div className="breadth">
      <span className="lbl">Stocks above their 200-day average</span>
      <div className="breadth-value">
        <b>{pc(now)}</b>
        {then != null && now != null && (
          <small className={tone(now - then)}>
            {now >= then ? '▲' : '▼'} {Math.abs(now - then).toFixed(0)} pts in a month
          </small>
        )}
      </div>
      <div className="breadth-track" role="img" aria-label={`${pc(now)} today, ${pc(then)} a month ago`}>
        <i className="fill" style={{ width: `${now ?? 0}%` }} />
        {then != null && <i className="ghost" style={{ left: `${then}%` }} title={`${pc(then)} a month ago`} />}
        <i className="mid" />
      </div>
      <div className="breadth-scale">
        <span>0%</span>
        <span>mostly falling ← 50% → mostly rising</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function SummaryTable({ head, rows }: { head: string; rows: (Summary & { name: string })[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="sym">{head}</th>
            <th title="Liquid stocks in the group">Stocks</th>
            <th title="Median stock's change today">Day</th>
            <th title="Median stock's 1-week return">1W</th>
            <th title="Median stock's 1-month return">1M</th>
            <th title="Median stock's 3-month return">3M</th>
            <th title="Share above their 50-day average">&gt; 50D</th>
            <th title="Share above their 200-day average">&gt; 200D</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="static">
              <td className="sym"><b>{r.name}</b></td>
              <td>{r.n}</td>
              <td className={tone(r.chg)}>{fmtPct(r.chg, 2)}</td>
              <td className={tone(r.w1)}>{fmtPct(r.w1)}</td>
              <td className={tone(r.m1)}>{fmtPct(r.m1)}</td>
              <td className={tone(r.m3)}>{fmtPct(r.m3)}</td>
              <td>{pc(r.above50)}</td>
              <td>{pc(r.above200)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Market({ market }: { market: MarketData }) {
  const m = market;
  const recent = (a: (number | null)[]) => a.slice(-60).filter((v): v is number => v != null);
  return (
    <section className="market" id="market">
      <h3>Market <small>{m.liquid.toLocaleString('en-IN')} stocks with ₹1 Cr+ daily turnover</small></h3>
      <div className="tiles">
        <Tile label="Above 50-day average" value={pc(m.above50)} sub={`${pc(m.above50MonthAgo)} a month ago`}>
          <Spark data={recent(m.history.a50)} width={120} height={28} />
        </Tile>
        <Tile label="Advancers vs decliners" value={<>{m.advancers} <span className="muted">/</span> {m.decliners}</>} sub="rose / fell today">
          <Split up={m.advancers} down={m.decliners} upLabel="rose" downLabel="fell" />
        </Tile>
        <Tile label="New 52-week highs vs lows" value={<>{m.newHi} <span className="muted">/</span> {m.newLo}</>} sub="highs / lows today">
          <Split up={m.newHi} down={m.newLo} upLabel="new highs" downLabel="new lows" />
        </Tile>
        <Tile label="Median stock today" value={<span className={tone(m.medianChg)}>{fmtPct(m.medianChg, 2)}</span>} sub="half did better, half worse" />
      </div>
      <div className="market-grid">
        <BreadthChart history={m.history} />
        <SummaryTable head="By size" rows={m.groups.map((g) => ({ ...g, name: g.label }))} />
      </div>
      {m.deriv && <IndexPositioning deriv={m.deriv} />}
      <details>
        <summary>Sectors, strongest month first ({m.sectors.length})</summary>
        <SummaryTable head="Sector" rows={m.sectors.map((s) => ({ ...s, name: s.sector }))} />
        <p className="note">Sector is only known for the ~750 Nifty Total Market stocks. Figures are for the median stock in each group.</p>
      </details>
    </section>
  );
}
