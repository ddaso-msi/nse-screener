import { useEffect, useRef, useState } from 'react';
import { fmtDate, fmtPct, fmtPrice, monthOf, type Row } from './data';
import { NumInput } from './NumInput';
import { Delta, Icon, tone } from './ui';
import { NEW_PAPER, PAPER_FEE, type Paper, type PaperPosition } from './user';

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (v: number) => `${v < 0 ? '−' : ''}₹${int.format(Math.abs(Math.round(v)))}`;
const signedRupees = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}₹${int.format(Math.abs(Math.round(v)))}`;

/** Account value over time, with the Nifty 50 scaled to the same starting amount. */
function EquityChart({ equity, start }: { equity: Paper['equity']; start: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220, PAD = { l: 8, r: 66, t: 12, b: 22 };
  const n = equity.length;
  const base = equity.find((e) => e.nifty)?.nifty ?? null;
  const bench = equity.map((e) => (base && e.nifty ? (e.nifty / base) * start : null));
  const all = [start, ...equity.map((e) => e.value), ...bench.filter((v): v is number => v != null)];
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || start * 0.01;
  const plotW = width - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (k: number) => PAD.l + (k / Math.max(1, n - 1)) * plotW;
  const y = (v: number) => PAD.t + plotH - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * plotH;
  const line = (vals: (number | null)[]) => vals.map((v, k) => (v == null ? '' : `${k && vals[k - 1] != null ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const months = equity.map((e, k) => ({ d: e.date, k })).filter(({ d, k }) => k > 0 && Math.floor(d / 100) !== Math.floor(equity[k - 1].date / 100));

  return (
    <div className="chart">
      <div className="legend">
        <span><i className="c-price" />Your account</span>
        {base && <span><i className="c-sma50" />Nifty 50, same starting amount</span>}
      </div>
      <div className="chart-plot" ref={wrap}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Paper account value over time compared with the Nifty 50"
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left - PAD.l) / plotW) * (n - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <line className="axis zero" x1={PAD.l} x2={PAD.l + plotW} y1={y(start)} y2={y(start)} />
          <text className="tick" x={PAD.l + plotW + 6} y={y(start) + 3.5}>{(start / 1e5).toFixed(1)} L</text>
          {[lo, hi].filter((v) => Math.abs(v - start) > pad).map((v) => (
            <text key={v} className="tick" x={PAD.l + plotW + 6} y={y(v) + 3.5}>{(v / 1e5).toFixed(2)} L</text>
          ))}
          {months.map(({ d, k }) => <text key={d} className="tick" x={x(k)} y={H - 6} textAnchor="middle">{monthOf(d)}</text>)}
          <path className="line s-sma50" d={line(bench)} />
          <path className="line s-price" d={line(equity.map((e) => e.value))} />
          {hover != null && (
            <g>
              <line className="cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} />
              {bench[hover] != null && <circle className="dot d-sma50" cx={x(hover)} cy={y(bench[hover]!)} r={4} />}
              <circle className="dot" cx={x(hover)} cy={y(equity[hover].value)} r={4} />
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="tip" style={x(hover) > width / 2 ? { left: 8 } : { right: PAD.r + 4 }}>
            <div className="tip-date">{fmtDate(equity[hover].date)}</div>
            <dl>
              <dt><i className="c-price" />Account</dt><dd>{rupees(equity[hover].value)} <span className={tone(equity[hover].value - start)}>({fmtPct((equity[hover].value / start - 1) * 100)})</span></dd>
              {bench[hover] != null && <><dt><i className="c-sma50" />Nifty 50</dt><dd>{rupees(bench[hover]!)} <span className={tone(bench[hover]! - start)}>({fmtPct((bench[hover]! / start - 1) * 100)})</span></dd></>}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

export function PaperTab({ paper, onSave, onReload, rowOf, asOf, onOpenStock, onGoScreener }: {
  paper: Paper;
  onSave: (update: Paper | ((prev: Paper) => Paper)) => void;
  onReload: () => void;
  rowOf: Map<string, Row>;
  asOf: number;
  onOpenStock: (s: string) => void;
  onGoScreener: () => void;
}) {
  // the evening run fills orders and checks stops, so pick up its changes when the tab opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(onReload, []);

  const last = (p: PaperPosition) => rowOf.get(p.s)?.close ?? p.entry;
  const invested = paper.positions.reduce((v, p) => v + p.qty * last(p), 0);
  const equity = paper.cash + invested;
  const total = equity - paper.start;
  const wins = paper.closed.filter((c) => c.pnl > 0);
  const losses = paper.closed.filter((c) => c.pnl <= 0);
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const realised = paper.closed.reduce((s, c) => s + c.pnl, 0);
  const editPos = (id: number, patch: Partial<PaperPosition>) => onSave((p) => ({ ...p, positions: p.positions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const empty = !paper.positions.length && !paper.orders.length && !paper.closed.length;
  const riskOpen = paper.positions.reduce((v, p) => v + (p.stop ? Math.max(0, last(p) - p.stop) * p.qty : last(p) * p.qty), 0);

  return (
    <div className="bt paper">
      <div className="bt-head first">
        <div>
          <h2>Paper trading</h2>
          <p>A practice account with ₹{int.format(paper.start)} of virtual money. Orders fill at the next session's open; stops and targets are checked against each day's prices.</p>
        </div>
        {!empty && (
          <button className="plain" onClick={() => window.confirm('Reset the paper account to ₹10,00,000 and erase its history?') && onSave({ ...NEW_PAPER })}>
            Start over
          </button>
        )}
      </div>

      <div className="tiles">
        <div className="tile"><span>Account value</span><b>{rupees(equity)}</b><small className={tone(total)}>{signedRupees(total)} ({fmtPct((equity / paper.start - 1) * 100, 2)}) since the start</small></div>
        <div className="tile"><span>Cash</span><b>{rupees(paper.cash)}</b><small>{((paper.cash / equity) * 100).toFixed(0)}% of the account</small></div>
        <div className="tile"><span>In positions</span><b>{rupees(invested)}</b><small>{paper.positions.length} open · {paper.orders.length} waiting to fill</small></div>
        <div className="tile" title="What you would lose if every stop were hit; positions without a stop count in full"><span>At risk if stops hit</span><b>{rupees(riskOpen)}</b><small>{((riskOpen / equity) * 100).toFixed(1)}% of the account</small></div>
        <div className="tile">
          <span>Closed trades</span>
          <b>{paper.closed.length ? `${((wins.length / paper.closed.length) * 100).toFixed(0)}% won` : '–'}</b>
          <small>
            {paper.closed.length
              ? <>{paper.closed.length} trades · {signedRupees(realised)} · avg win {fmtPct(avg(wins.map((c) => c.pct)))} / loss {fmtPct(avg(losses.map((c) => c.pct)))}</>
              : 'None yet'}
          </small>
        </div>
      </div>

      {paper.notices.map((nt, i) => <p key={i} className="note">{fmtDate(nt.date, false)} · {nt.text}</p>)}

      {empty ? (
        <div className="empty-card">
          <Icon name="paper" size={30} />
          <div>
            <b>Place your first paper trade</b>
            <p>Open any stock, press "Paper trade this stock", set a stop, and the ticket sizes the position so a stopped-out trade costs 1% of the account. The order fills at the next session's opening price.</p>
          </div>
          <button className="primary" onClick={onGoScreener}>Find stocks <Icon name="arrowRight" /></button>
        </div>
      ) : (
        <>
          {paper.equity.length > 1 && (
            <section className="panel"><h3>Account value</h3><EquityChart equity={paper.equity} start={paper.start} /></section>
          )}

          {paper.orders.length > 0 && (
            <section>
              <h3>Waiting to fill <small>at the next session's open</small></h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th className="sym">Stock</th><th>Shares</th><th>Last close</th><th>About</th><th>Stop</th><th>Target</th><th /></tr></thead>
                  <tbody>
                    {paper.orders.map((o) => (
                      <tr key={o.id} onClick={() => onOpenStock(o.s)}>
                        <td className="sym"><b>{o.s}</b><small>{rowOf.get(o.s)?.name}</small></td>
                        <td>{int.format(o.qty)}</td>
                        <td>{fmtPrice(rowOf.get(o.s)?.close)}</td>
                        <td>{rupees(o.qty * (rowOf.get(o.s)?.close ?? 0))}</td>
                        <td>{o.stop ? fmtPrice(o.stop) : '–'}</td>
                        <td>{o.target ? fmtPrice(o.target) : '–'}</td>
                        <td><button className="link" onClick={(e) => { e.stopPropagation(); onSave((p) => ({ ...p, orders: p.orders.filter((x) => x.id !== o.id) })); }}>Cancel</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h3>Open positions <small>{paper.positions.length}</small></h3>
            {paper.positions.length === 0 ? <p className="note">No open positions.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sym">Stock</th><th>Shares</th><th>Bought at</th><th>Last close</th><th>Day</th>
                      <th>Profit / loss</th><th title="Editable. The evening run sells if the day's low touches it.">Stop</th>
                      <th title="Editable. The evening run sells if the day's high touches it.">Target</th><th>Since</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {paper.positions.map((p) => {
                      const now = last(p);
                      const pnl = (now * (1 - PAPER_FEE) - p.entry * (1 + PAPER_FEE)) * p.qty;
                      return (
                        <tr key={p.id} onClick={() => onOpenStock(p.s)}>
                          <td className="sym"><b>{p.s}</b><small>{rowOf.get(p.s)?.name}{p.note && ` · ${p.note}`}</small></td>
                          <td>{int.format(p.qty)}</td>
                          <td>{fmtPrice(p.entry)}</td>
                          <td>{fmtPrice(now)}</td>
                          <td><Delta value={rowOf.get(p.s)?.chg} /></td>
                          <td className={tone(pnl)}><b>{signedRupees(pnl)}</b> <small>{fmtPct((now / p.entry - 1) * 100)}</small></td>
                          <td onClick={(e) => e.stopPropagation()}><span className="inline-edit"><NumInput label={`${p.s} stop`} placeholder="none" value={p.stop} onChange={(v) => editPos(p.id, { stop: v })} /></span></td>
                          <td onClick={(e) => e.stopPropagation()}><span className="inline-edit"><NumInput label={`${p.s} target`} placeholder="none" value={p.target} onChange={(v) => editPos(p.id, { target: v })} /></span></td>
                          <td>{fmtDate(p.entryDate, false)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {p.sell
                              ? <button className="link" onClick={() => editPos(p.id, { sell: undefined })}>Selling at next open · undo</button>
                              : <button className="link" onClick={() => editPos(p.id, { sell: asOf })}>Sell at next open</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {paper.closed.length > 0 && (
            <section>
              <h3>Closed trades <small>{paper.closed.length}</small></h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th className="sym">Stock</th><th>Shares</th><th>Bought</th><th>Sold</th><th>Profit / loss</th><th className="left">How it ended</th><th>Held</th></tr></thead>
                  <tbody>
                    {paper.closed.map((c, i) => (
                      <tr key={i} onClick={() => onOpenStock(c.s)}>
                        <td className="sym"><b>{c.s}</b><small>{c.note}</small></td>
                        <td>{int.format(c.qty)}</td>
                        <td>{fmtPrice(c.entry)} <small className="muted">{fmtDate(c.entryDate, false)}</small></td>
                        <td>{fmtPrice(c.exit)} <small className="muted">{fmtDate(c.exitDate, false)}</small></td>
                        <td className={tone(c.pnl)}><b>{signedRupees(c.pnl)}</b> <small>{fmtPct(c.pct)}</small></td>
                        <td className="left">{c.reason}</td>
                        <td>{fmtDate(c.entryDate, false)} – {fmtDate(c.exitDate, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <p className="note disclaimer">
        Fills use end-of-day prices: orders at the next open, stops and targets at their level (or the open, if the price gaps through). Each side is charged {(PAPER_FEE * 100).toFixed(2)}% for brokerage, taxes and slippage. Real trading adds liquidity limits, partial fills and the pressure of real money.
      </p>
    </div>
  );
}
