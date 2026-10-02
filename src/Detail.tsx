import { useEffect, useState } from 'react';
import { Chart } from './Chart';
import { NumInput } from './NumInput';
import type { WatchItem } from './user';
import { CAP_LABEL, IDX_LABEL, fmtMcap, fileSafe, fmtCr, fmtDate, fmtPct, fmtPrice, fmtQty, type History, type Row } from './data';

const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down');

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={cls}>{value}</b>
    </div>
  );
}

export function Detail({ row, onClose, watch, onToggleWatch, onEditWatch }: {
  row: Row;
  onClose: () => void;
  watch: WatchItem | null;
  onToggleWatch: () => void;
  onEditWatch: (patch: Partial<WatchItem>) => void;
}) {
  const [hist, setHist] = useState<History | null>(null);
  const [error, setError] = useState(false);

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pos = row.hi52 > row.lo52 ? ((row.close - row.lo52) / (row.hi52 - row.lo52)) * 100 : 50;
  const short = row.sessions < 252;

  return (
    <aside className="detail" aria-label={`${row.s} details`}>
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

      <div className="quote">
        <strong>₹{fmtPrice(row.close)}</strong>
        <b className={tone(row.chg)}>{fmtPct(row.chg, 2)}</b>
      </div>

      {hist ? <Chart hist={hist} /> : <div className="chart-empty">{error ? 'Price history unavailable.' : 'Loading chart…'}</div>}

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

      <h3>Fundamentals</h3>
      <div className="stats">
        <Stat label="Market cap" value={row.mcap == null ? '–' : `₹${fmtMcap(row.mcap)}`} />
        <Stat label="P/E (trailing)" value={row.pe == null ? 'None (loss or n/a)' : row.pe.toFixed(1)} />
        <Stat label="EPS (trailing)" value={row.eps == null ? '–' : `₹${fmtPrice(row.eps)}`} />
        <Stat label="Earnings growth 1Y" value={fmtPct(row.epsG)} cls={tone(row.epsG)} />
        <Stat label="Dividend yield" value={row.divY == null ? '–' : `${row.divY.toFixed(2)}%`} />
        <Stat label="Next ex-date" value={row.nextEx ? fmtDate(row.nextEx.ex) : 'None announced'} />
      </div>

      <h3>Returns</h3>
      <div className="stats">
        <Stat label="1 week" value={fmtPct(row.w1)} cls={tone(row.w1)} />
        <Stat label="1 month" value={fmtPct(row.m1)} cls={tone(row.m1)} />
        <Stat label="3 months" value={fmtPct(row.m3)} cls={tone(row.m3)} />
        <Stat label="6 months" value={fmtPct(row.m6)} cls={tone(row.m6)} />
        <Stat label="1 year" value={fmtPct(row.y1)} cls={tone(row.y1)} />
        <Stat label="RSI (14)" value={row.rsi == null ? '–' : row.rsi.toFixed(1)} />
        <Stat label="Relative strength" value={row.rs == null ? '–' : `${row.rs} of 99`} />
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
        <Stat label="Delivery" value={row.deliv == null ? '–' : `${row.deliv.toFixed(1)}%`} />
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
