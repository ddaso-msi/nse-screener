import { useEffect, useState } from 'react';
import { Chart } from './Chart';
import { NumInput } from './NumInput';
import { Explain } from './Help';
import type { Term } from './glossary';
import { Delta } from './ui';
import { PAPER_FEE, type Paper, type WatchItem } from './user';
import { BUILD_LABEL, CAP_LABEL, IDX_LABEL, PATTERN_LABEL, fmtMcap, fileSafe, fmtCr, fmtDate, fmtInt, fmtPct, fmtPrice, fmtQty, monthOf, type History, type Row } from './data';

const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down');

interface Filed {
  filings: { date: number; subject: string; text: string; key: boolean }[];
  meetings: { date: number; purpose: string; results: boolean }[];
}

function Stat({ label, value, cls = '', term }: { label: string; value: string; cls?: string; term?: Term }) {
  return (
    <div className="stat">
      <span>{label}{term && <Explain term={term} />}</span>
      <b className={cls}>{value}</b>
    </div>
  );
}

const quarterName = (q: number) => `${monthOf(q)} ${Math.floor(q / 10000)}`;
const growth = (now: number, then: number | undefined) => (then != null && then > 0 ? (now / then - 1) * 100 : null);

/** Quarterly results from the company's filings: the headline ratios and the last six quarters. */
function Results({ row, fin }: { row: Row; fin: NonNullable<History['fin']> }) {
  const byQ = new Map(fin.q.map((x) => [x.q, x]));
  const shown = fin.q.slice(-6).reverse();
  const latest = fin.q[fin.q.length - 1];
  const lender = fin.kind !== 'N';
  return (
    <>
      <h3>Quarterly results</h3>
      <div className="stats">
        <Stat label="Sales growth (YoY)" value={fmtPct(row.revYoY)} cls={tone(row.revYoY)} />
        <Stat label="Profit growth (YoY)" value={fmtPct(row.patYoY)} cls={tone(row.patYoY)} />
        <Stat term="roe" label="Return on equity" value={row.roe == null ? '–' : `${row.roe.toFixed(1)}%`} />
        {!lender && <Stat term="opm" label="Operating margin" value={row.opm == null ? '–' : `${row.opm.toFixed(1)}%`} />}
        {!lender && <Stat term="de" label="Debt to equity" value={row.de == null ? '–' : row.de.toFixed(2)} />}
      </div>
      <div className="table-wrap results">
        <table className="static">
          <thead><tr><th className="left">Quarter to</th><th>{lender ? 'Income' : 'Sales'} ₹ Cr</th><th>Profit ₹ Cr</th>{!lender && <th>Margin</th>}</tr></thead>
          <tbody>
            {shown.map((x) => {
              const then = byQ.get(x.q - 10000);
              const rev = growth(x.rev, then?.rev), pat = growth(x.pat, then?.pat);
              return (
                <tr key={x.q}>
                  <td className="left">{quarterName(x.q)}</td>
                  <td>{fmtInt(x.rev)}{rev != null && <small className={tone(rev)}>{fmtPct(rev, 0)}</small>}</td>
                  <td className={x.pat < 0 ? 'down' : ''}>{fmtInt(x.pat)}{pat != null && <small className={tone(pat)}>{fmtPct(pat, 0)}</small>}</td>
                  {!lender && <td>{x.op != null && x.rev > 0 ? `${((x.op / x.rev) * 100).toFixed(1)}%` : '–'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        {fin.cons ? 'Consolidated' : 'Standalone'} figures from the company's filings to NSE; the small percentages compare with the same quarter a year earlier.
        The latest, for the quarter to {fmtDate(latest.q)}, was filed on {fmtDate(latest.at)}.
        {fin.kind === 'B' && ' For a bank, income is interest plus other income; operating margin and debt to equity do not apply.'}
        {fin.kind === 'F' && ' For a lender, operating margin and debt to equity do not apply.'}
      </p>
    </>
  );
}

export function Detail({ row, onClose, onOpenChart, onLogTrade, watch, onToggleWatch, onEditWatch, floating = false, paper, onSavePaper, asOf, rowOf }: {
  row: Row;
  /** Shown as an overlay drawer instead of a docked column */
  floating?: boolean;
  onOpenChart: () => void;
  onLogTrade: () => void;
  onClose: () => void;
  watch: WatchItem | null;
  onToggleWatch: () => void;
  onEditWatch: (patch: Partial<WatchItem>) => void;
  paper: Paper;
  onSavePaper: (update: Paper | ((prev: Paper) => Paper)) => void;
  asOf: number;
  rowOf: Map<string, Row>;
}) {
  const [ticket, setTicket] = useState(false);
  const [stop, setStop] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [risk, setRisk] = useState<number | null>(1);
  const [qtyEdit, setQtyEdit] = useState<number | null>(null);
  useEffect(() => { setTicket(false); setStop(null); setTarget(null); setQtyEdit(null); }, [row.s]);

  const held = paper.positions.find((p) => p.s === row.s);
  const pending = paper.orders.find((o) => o.s === row.s);
  const equity = paper.cash + paper.positions.reduce((v, p) => v + p.qty * (rowOf.get(p.s)?.close ?? p.entry), 0);
  const perShare = stop != null && stop < row.close ? row.close - stop : null;
  // size the position so that hitting the stop loses `risk`% of the account
  const sized = perShare ? Math.floor((equity * ((risk ?? 1) / 100)) / perShare) : Math.floor((equity * 0.1) / row.close);
  const affordable = Math.floor(paper.cash / (row.close * (1 + PAPER_FEE)));
  const qty = Math.max(0, Math.min(qtyEdit ?? sized, affordable));
  const placeOrder = () => {
    onSavePaper((p) => ({ ...p, orders: [...p.orders, { id: Date.now(), s: row.s, qty, stop, target, note: watch?.note ?? '', placed: asOf }] }));
    setTicket(false);
  };
  const [hist, setHist] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [filed, setFiled] = useState<Filed | null>(null);

  useEffect(() => {
    setHist(null);
    setError(false);
    let live = true;
    fetch(`/data/h/${fileSafe(row.s)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h) => live && setHist(h))
      .catch(() => live && setError(true));
    return () => void (live = false);
  }, [row.s]);

  useEffect(() => {
    setFiled(null);
    if (row.etf) return; // funds file no announcements
    let live = true;
    fetch(`/data/n/${fileSafe(row.s)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => live && setFiled(f))
      .catch(() => {});
    return () => void (live = false);
  }, [row.s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pos = row.hi52 > row.lo52 ? ((row.close - row.lo52) / (row.hi52 - row.lo52)) * 100 : 50;
  const short = row.sessions < 252;

  return (
    <aside className={`detail ${floating ? 'floating' : ''}`} aria-label={`${row.s} details`}>
      <header>
        <div>
          <h2>{row.s}</h2>
          <p>{row.name}</p>
          <div className="tags">
            {row.cap && <span>{CAP_LABEL[row.cap]}</span>}
            {row.idx && <span>{IDX_LABEL[row.idx]}</span>}
            {row.sector && <span>{row.sector}</span>}
            {row.series !== 'EQ' && <span className="warn">{row.series} series · trade-to-trade</span>}
          </div>
        </div>
        <button className="icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className={`watchbox ${watch ? 'on' : ''}`}>
        <button onClick={onToggleWatch} aria-pressed={!!watch}>
          {watch ? '★ On watchlist' : '☆ Add to watchlist'}
        </button>
        {watch && (
          <>
            <label>
              Alert level ₹
              <NumInput label="Alert level" placeholder="none" value={watch.level} onChange={(v) => onEditWatch({ level: v })} />
            </label>
            <textarea
              aria-label="Note"
              placeholder="Why are you watching this? The brief shows this note."
              value={watch.note}
              onChange={(e) => onEditWatch({ note: e.target.value })}
              rows={2}
            />
          </>
        )}
      </div>

      <div className="paperbox">
        {held ? (
          <p>Paper position: <b>{held.qty} shares</b> bought at ₹{fmtPrice(held.entry)} · <span className={tone(row.close - held.entry)}>{fmtPct((row.close / held.entry - 1) * 100)}</span>{held.stop ? ` · stop ₹${fmtPrice(held.stop)}` : ''}</p>
        ) : pending ? (
          <p>Paper order: buy <b>{pending.qty} shares</b> at the next open{pending.stop ? ` · stop ₹${fmtPrice(pending.stop)}` : ''}. <button className="link" onClick={() => onSavePaper((p) => ({ ...p, orders: p.orders.filter((o) => o !== pending) }))}>Cancel</button></p>
        ) : !ticket ? (
          <div className="acct-row">
            <button onClick={() => setTicket(true)}>Paper trade this stock</button>
            <button className="plain" onClick={onLogTrade} title="Record a real trade you took in this stock">Add to journal</button>
          </div>
        ) : (
          <div className="ticket">
            <label>Stop-loss ₹<NumInput label="Stop-loss price" placeholder="none" value={stop} onChange={(v) => { setStop(v); setQtyEdit(null); }} /></label>
            <label>Target ₹<NumInput label="Target price" placeholder="none" value={target} onChange={setTarget} /></label>
            <label title="How much of the account you lose if the stop is hit">Risk %<NumInput label="Risk percent of account" placeholder="1" value={risk} onChange={(v) => { setRisk(v); setQtyEdit(null); }} /></label>
            <label>Shares<NumInput label="Shares" placeholder="0" value={qty} onChange={setQtyEdit} /></label>
            <p className="note">
              {qty} shares ≈ ₹{fmtPrice(qty * row.close)} of ₹{fmtPrice(paper.cash)} cash.
              {perShare ? ` If the stop is hit you lose about ₹${fmtPrice(qty * perShare)} (${(((qty * perShare) / equity) * 100).toFixed(1)}% of the account).` : ' Set a stop to size the position by risk; without one it defaults to 10% of the account.'}
              {stop != null && stop >= row.close && ' The stop must be below the price.'}
            </p>
            <div>
              <button className="primary" onClick={placeOrder} disabled={qty <= 0 || (stop != null && stop >= row.close)}>Buy at the next open</button>
              <button className="plain" onClick={() => setTicket(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="quote">
        <strong>₹{fmtPrice(row.close)}</strong>
        <Delta value={row.chg} />
        <span className="muted">today</span>
      </div>

      <button className="link first open-chart" onClick={onOpenChart}>Open full chart with indicators and drawing tools →</button>
      {hist ? <Chart hist={hist} /> : <div className="chart-empty">{error ? 'Price history unavailable.' : 'Loading chart…'}</div>}

      {row.pat.length > 0 && (
        <p className="note">
          Pattern detected: {row.pat.map((p) => PATTERN_LABEL[p]).join(', ')}. The shaded area on the chart shows the shape; the line is the pivot a breakout would need to clear.
        </p>
      )}

      {hist && hist.ca.length > 0 && (
        <p className="note">
          Earlier prices are adjusted for:{' '}
          {hist.ca
            .map((e) => `${e.text ?? 'an unannounced price gap (inferred)'} on ${fmtDate(e.date)}`)
            .join('; ')}
          .
        </p>
      )}

      <div className="range52">
        <div className="range52-labels">
          <span>52W low ₹{fmtPrice(row.lo52)}</span>
          <span>52W high ₹{fmtPrice(row.hi52)}</span>
        </div>
        <div className="range52-bar">
          <i style={{ left: `${Math.max(0, Math.min(100, pos))}%` }} />
        </div>
        <div className="range52-labels muted">
          <span>{fmtPct(row.fromLo)} above low</span>
          <span>{fmtPct(row.fromHi)} from high</span>
        </div>
        {short && <p className="note">Only {row.sessions} sessions of history, so the range covers less than 52 weeks.</p>}
      </div>

      {row.etf && (
        <>
          <h3>About this fund</h3>
          <div className="stats">
            <Stat label="Tracks" value={row.etf.underlying} />
            <Stat label="Type" value={row.etf.category} />
            <Stat term="ter" label="Yearly cost" value={row.etf.ter == null ? '–' : `${row.etf.ter.toFixed(2)}%`} />
            <Stat label="NAV" value={row.etf.nav == null ? '–' : `₹${fmtPrice(row.etf.nav)}`} />
            <Stat term="nav" label="Price vs NAV today" value={fmtPct(row.etf.prem, 2)} />
            <Stat label="Price vs NAV, 60-day avg" value={fmtPct(row.etf.premAvg, 2)} />
          </div>
          <p className="note">
            Yearly cost is the fund's expense ratio. Price vs NAV shows whether the market price is above (+) or below (−) the value of what the fund holds.
            {row.avgTurnover < 1 && ' This fund trades less than ₹1 Cr a day, so buying or selling at a fair price can be hard.'}
          </p>
        </>
      )}

      {!row.etf && <h3>Fundamentals</h3>}
      <div className="stats" hidden={!!row.etf}>
        <Stat label="Market cap" value={row.mcap == null ? '–' : `₹${fmtMcap(row.mcap)}`} />
        <Stat term="pe" label="P/E (trailing)" value={row.pe == null ? 'None (loss or n/a)' : row.pe.toFixed(1)} />
        <Stat label="EPS (trailing)" value={row.eps == null ? '–' : `₹${fmtPrice(row.eps)}`} />
        <Stat label="Earnings growth 1Y" value={fmtPct(row.epsG)} cls={tone(row.epsG)} />
        <Stat label="Dividend yield" value={row.divY == null ? '–' : `${row.divY.toFixed(2)}%`} />
        <Stat label="Next ex-date" value={row.nextEx ? fmtDate(row.nextEx.ex) : 'None announced'} />
      </div>

      {!row.etf && hist?.fin && <Results row={row} fin={hist.fin} />}

      {row.fo === 1 && (
        <>
          <h3>Derivatives</h3>
          <div className="stats">
            <Stat term="futOi" label="Futures OI today" value={fmtPct(row.foOiChg)} cls={tone(row.foOiChg)} />
            <Stat label="Futures OI, 5 sessions" value={fmtPct(row.oi5)} cls={tone(row.oi5)} />
            <Stat label="Position today" value={row.build ? BUILD_LABEL[row.build] : 'No clear change'} cls={row.build ? (row.build === 'LB' || row.build === 'SC' ? 'up' : 'down') : ''} />
            <Stat term="pcr" label="Put/call ratio" value={row.pcr == null ? '–' : row.pcr.toFixed(2)} />
            <Stat label="Implied volatility" value={row.iv == null ? '–' : `${row.iv.toFixed(1)}%`} />
            <Stat term="ivRank" label="IV rank (1 year)" value={row.ivRank == null ? '–' : `${row.ivRank.toFixed(0)} of 100`} />
          </div>
          {row.ban === 1 && <p className="note down">In the F&O ban period: no new derivative positions are allowed until open interest falls.</p>}
        </>
      )}

      {filed && (filed.meetings.length > 0 || filed.filings.length > 0) && (
        <>
          <h3>Filings and events</h3>
          <ul className="acts filings">
            {filed.meetings.filter((m) => m.date >= (hist?.d[hist.d.length - 1] ?? 0)).map((m) => (
              <li key={`m${m.date}`} className="upcoming">
                <span>{fmtDate(m.date)}</span>
                <div>Board meeting: {m.purpose}</div>
                <em>upcoming</em>
              </li>
            ))}
            {filed.filings.slice(0, 12).map((f, i) => (
              <li key={i} className={f.key ? 'key' : ''}>
                <span>{fmtDate(f.date)}</span>
                <div>
                  <b>{f.subject}</b>
                  <p>{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Returns</h3>
      <div className="stats">
        <Stat label="1 week" value={fmtPct(row.w1)} cls={tone(row.w1)} />
        <Stat label="1 month" value={fmtPct(row.m1)} cls={tone(row.m1)} />
        <Stat label="3 months" value={fmtPct(row.m3)} cls={tone(row.m3)} />
        <Stat label="6 months" value={fmtPct(row.m6)} cls={tone(row.m6)} />
        <Stat label="1 year" value={fmtPct(row.y1)} cls={tone(row.y1)} />
        <Stat term="rsi" label="RSI (14)" value={row.rsi == null ? '–' : row.rsi.toFixed(1)} />
        <Stat term="rs" label="Relative strength" value={row.rs == null ? '–' : `${row.rs} of 99`} />
      </div>

      <h3>Trend</h3>
      <div className="stats">
        <Stat label="vs 20 DMA" value={fmtPct(row.vs20)} cls={tone(row.vs20)} />
        <Stat label="vs 50 DMA" value={fmtPct(row.vs50)} cls={tone(row.vs50)} />
        <Stat label="vs 200 DMA" value={fmtPct(row.vs200)} cls={tone(row.vs200)} />
        <Stat
          label="50/200 cross"
          value={row.cross === 1 ? 'Golden (≤10 sessions)' : row.cross === -1 ? 'Death (≤10 sessions)' : 'None recent'}
        />
      </div>

      <h3>Volume & delivery</h3>
      <div className="stats">
        <Stat label="Volume" value={fmtQty(row.vol)} />
        <Stat label="vs 20D average" value={row.volX == null ? '–' : `${row.volX.toFixed(2)}×`} />
        <Stat label="Turnover" value={`₹${fmtCr(row.turnover)} Cr`} />
        <Stat label="Avg turnover (20D)" value={`₹${fmtCr(row.avgTurnover)} Cr`} />
        <Stat term="deliv" label="Delivery" value={row.deliv == null ? '–' : `${row.deliv.toFixed(1)}%`} />
        <Stat label="Avg delivery (20D)" value={row.delivAvg == null ? '–' : `${row.delivAvg.toFixed(1)}%`} />
      </div>

      {hist && hist.acts.length > 0 && (
        <>
          <h3>Corporate actions, last 12 months</h3>
          <ul className="acts">
            {[...hist.acts].reverse().map((a) => (
              <li key={`${a.ex}${a.text}`} className={a.ex > hist.d[hist.d.length - 1] ? 'upcoming' : ''}>
                <span>{fmtDate(a.ex)}</span>
                {a.text}
                {a.ex > hist.d[hist.d.length - 1] && <em>upcoming</em>}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="links">
        <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(row.s)}`} target="_blank" rel="noreferrer">
          NSE quote ↗
        </a>
        <a href={`https://www.screener.in/company/${encodeURIComponent(row.s)}/`} target="_blank" rel="noreferrer">
          Fundamentals on Screener.in ↗
        </a>
        <a href={`https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(row.s.replace(/[&-]/g, '_'))}`} target="_blank" rel="noreferrer">
          TradingView ↗
        </a>
      </div>
    </aside>
  );
}
