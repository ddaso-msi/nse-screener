import { useEffect, useMemo, useState } from 'react';
import { fmtDate, fmtPct, fmtPrice, type Row } from './data';
import { NumInput } from './NumInput';
import { Explain } from './Help';
import { Icon, tone } from './ui';
import type { Journal, JournalTrade } from './user';

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (v: number) => `${v < 0 ? '−' : ''}₹${int.format(Math.abs(Math.round(v)))}`;
const signedRupees = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}₹${int.format(Math.abs(Math.round(v)))}`;
const fmtR = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}R`);
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// 20261001 <-> "2026-10-01" (what a date input uses)
const toInput = (key: number) => `${Math.floor(key / 10000)}-${String(Math.floor(key / 100) % 100).padStart(2, '0')}-${String(key % 100).padStart(2, '0')}`;
const toKey = (text: string) => Number(text.replaceAll('-', ''));
const daysBetween = (a: number, b: number) => Math.round((Date.parse(toInput(b)) - Date.parse(toInput(a))) / 86400000);

const SETUPS = ['Breakout', 'Pullback in an uptrend', 'Base or consolidation', 'Reversal', 'Results or news', 'Long-term holding', 'Other'];

/** Rupees lost per share if the first stop is hit; null when the trade had no stop. */
const riskPerShare = (t: Pick<JournalTrade, 'entry' | 'stop0'>) => (t.stop0 != null && t.stop0 < t.entry ? t.entry - t.stop0 : null);
const pnlOf = (t: JournalTrade, price: number) => (price - t.entry) * t.qty - (t.fees ?? 0);
const rOf = (t: JournalTrade, price: number) => {
  const per = riskPerShare(t);
  return per ? pnlOf(t, price) / (per * t.qty) : null;
};

function NewTrade({ journal, rowOf, asOf, prefill, onAdd }: {
  journal: Journal;
  rowOf: Map<string, Row>;
  asOf: number;
  prefill: string | null;
  onAdd: (t: JournalTrade) => void;
}) {
  const [s, setS] = useState(prefill ?? '');
  const [date, setDate] = useState(toInput(asOf));
  const [price, setPrice] = useState<number | null>(prefill ? rowOf.get(prefill)?.close ?? null : null);
  const [stop, setStop] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [setup, setSetup] = useState(SETUPS[0]);
  const [reason, setReason] = useState('');
  const symbols = useMemo(() => [...rowOf.keys()].sort(), [rowOf]);

  const symbol = s.trim().toUpperCase();
  const row = rowOf.get(symbol);
  const pickSymbol = (text: string) => {
    setS(text);
    const known = rowOf.get(text.trim().toUpperCase());
    if (known && price == null) setPrice(known.close);
  };

  const per = price != null && stop != null && stop < price ? price - stop : null;
  const budget = journal.capital != null ? journal.capital * (journal.riskPct / 100) : null;
  // the largest position that loses no more than the chosen share of capital at the stop, and that the capital can pay for
  const sized = per && budget && price ? Math.max(0, Math.min(Math.floor(budget / per), Math.floor(journal.capital! / price))) : null;
  const badStop = price != null && stop != null && stop >= price;
  const ready = symbol && price != null && price > 0 && qty != null && qty > 0 && !badStop && toKey(date) > 0;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onAdd({ id: Date.now(), s: symbol, qty: qty!, entry: price!, entryDate: toKey(date), stop0: stop, stop, target, setup, reason: reason.trim() });
    setS(''); setPrice(null); setStop(null); setTarget(null); setQty(null); setReason('');
  };

  return (
    <form className="jform" onSubmit={add}>
      <label>
        Stock or ETF
        <input list="journal-symbols" value={s} onChange={(e) => pickSymbol(e.target.value)} placeholder="e.g. RELIANCE" autoCapitalize="characters" required />
        <datalist id="journal-symbols">{symbols.map((x) => <option key={x} value={x} />)}</datalist>
      </label>
      <label>Bought on<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
      <label>Price paid ₹<NumInput label="Price paid" placeholder="0.00" value={price} onChange={setPrice} /></label>
      <label>Stop-loss ₹<NumInput label="Stop-loss price" placeholder="none" value={stop} onChange={setStop} /></label>
      <label>Target ₹<NumInput label="Target price" placeholder="none" value={target} onChange={setTarget} /></label>
      <label>Shares<NumInput label="Shares" placeholder="0" value={qty} onChange={setQty} /></label>
      <label>
        Kind of trade
        <select value={setup} onChange={(e) => setSetup(e.target.value)}>{SETUPS.map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label className="wide">
        Why are you taking it?
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What you saw, and what would prove you wrong." />
      </label>

      <p className="note wide">
        {symbol && (row ? <>{row.name} · last close ₹{fmtPrice(row.close)}. </> : <>{symbol} isn't in today's NSE list, so the journal can't show its latest price. </>)}
        {badStop && 'The stop must be below the price paid. '}
        {journal.capital == null
          ? 'Enter your trading capital above and the journal will suggest how many shares to buy.'
          : !per
            ? 'Set a stop below the price and the journal will suggest how many shares to buy.'
            : sized != null && (
              <>
                Risking {journal.riskPct}% of {rupees(journal.capital)} is {rupees(budget!)}. With ₹{fmtPrice(per)} at risk per share, that is <b>{int.format(sized)} shares</b> (about {rupees(sized * price!)}).{' '}
                {qty !== sized && sized > 0 && <button type="button" className="link" onClick={() => setQty(sized)}>Use {int.format(sized)}</button>}
              </>
            )}
        {qty != null && qty > 0 && price != null && (
          <>
            {' '}{int.format(qty)} shares cost {rupees(qty * price)}
            {per && <>, with {rupees(qty * per)} at risk{journal.capital ? ` (${(((qty * per) / journal.capital) * 100).toFixed(1)}% of capital)` : ''}</>}
            {per && target != null && target > price && <>, aiming for {((target - price) / per).toFixed(1)} times the risk</>}.
          </>
        )}
      </p>
      <div className="wide"><button className="primary" disabled={!ready}>Add to journal</button></div>
    </form>
  );
}

function CloseTrade({ trade, last, asOf, onDone, onCancel }: {
  trade: JournalTrade;
  last: number | null;
  asOf: number;
  onDone: (patch: Partial<JournalTrade>) => void;
  onCancel: () => void;
}) {
  const [exit, setExit] = useState<number | null>(last);
  const [date, setDate] = useState(toInput(Math.max(asOf, trade.entryDate)));
  const [fees, setFees] = useState<number | null>(null);
  const [lesson, setLesson] = useState('');
  const ok = exit != null && exit > 0 && toKey(date) >= trade.entryDate;
  return (
    <form
      className="jform closing"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onDone({ exit: exit!, exitDate: toKey(date), fees: fees ?? 0, lesson: lesson.trim() });
      }}
    >
      <label>Sold at ₹<NumInput label="Sale price" placeholder="0.00" value={exit} onChange={setExit} /></label>
      <label>Sold on<input type="date" value={date} min={toInput(trade.entryDate)} onChange={(e) => setDate(e.target.value)} required /></label>
      <label title="Brokerage, taxes and other charges for buying and selling, from your contract notes">Total charges ₹<NumInput label="Total charges" placeholder="0" value={fees} onChange={setFees} /></label>
      <label className="wide">
        What did you learn?
        <textarea rows={2} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="Did you follow your plan? What would you do differently?" />
      </label>
      <div className="wide acct-row">
        <button className="primary" disabled={!ok}>Close trade</button>
        <button type="button" className="plain" onClick={onCancel}>Cancel</button>
        {exit != null && exit > 0 && <span className={`muted ${tone(pnlOf({ ...trade, fees: fees ?? 0 }, exit))}`}>{signedRupees(pnlOf({ ...trade, fees: fees ?? 0 }, exit))} · {fmtR(rOf({ ...trade, fees: fees ?? 0 }, exit))}</span>}
      </div>
    </form>
  );
}

/** A record of real trades: plan the size, write down why, and review the results. */
export function JournalTab({ journal, onSave, rowOf, asOf, onOpenStock, prefill }: {
  journal: Journal;
  onSave: (update: Journal | ((prev: Journal) => Journal)) => void;
  rowOf: Map<string, Row>;
  asOf: number;
  onOpenStock: (s: string) => void;
  prefill: string | null;
}) {
  const [closing, setClosing] = useState<number | null>(null);
  const [adding, setAdding] = useState(!!prefill);
  useEffect(() => { if (prefill) setAdding(true); }, [prefill]);

  const open = journal.trades.filter((t) => t.exit == null);
  const closed = journal.trades.filter((t) => t.exit != null).sort((a, b) => b.exitDate! - a.exitDate! || b.id - a.id);
  const lastOf = (t: JournalTrade) => rowOf.get(t.s)?.close ?? null;
  const edit = (id: number, patch: Partial<JournalTrade>) => onSave((j) => ({ ...j, trades: j.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const remove = (t: JournalTrade) => window.confirm(`Remove the ${t.s} trade from the journal?`) && onSave((j) => ({ ...j, trades: j.trades.filter((x) => x.id !== t.id) }));
  const openStock = (s: string) => rowOf.has(s) && onOpenStock(s);

  const results = closed.map((t) => ({ t, pnl: pnlOf(t, t.exit!), r: rOf(t, t.exit!) }));
  const wins = results.filter((x) => x.pnl > 0);
  const losses = results.filter((x) => x.pnl <= 0);
  const realised = results.reduce((s, x) => s + x.pnl, 0);
  const rs = results.map((x) => x.r).filter((v): v is number => v != null);
  const invested = open.reduce((v, t) => v + t.qty * (lastOf(t) ?? t.entry), 0);
  const unrealised = open.reduce((v, t) => v + (lastOf(t) != null ? pnlOf(t, lastOf(t)!) : 0), 0);
  // what is lost from here if every stop is hit; a trade without a stop counts in full
  const atRisk = open.reduce((v, t) => {
    const now = lastOf(t) ?? t.entry;
    return v + (t.stop != null ? Math.max(0, now - t.stop) : now) * t.qty;
  }, 0);
  const setups = [...new Set(results.map((x) => x.t.setup))].map((name) => {
    const mine = results.filter((x) => x.t.setup === name);
    const mineR = mine.map((x) => x.r).filter((v): v is number => v != null);
    return { name, n: mine.length, won: (mine.filter((x) => x.pnl > 0).length / mine.length) * 100, r: avg(mineR), pnl: mine.reduce((s, x) => s + x.pnl, 0) };
  }).sort((a, b) => b.pnl - a.pnl);
  const empty = !journal.trades.length;

  return (
    <div className="bt paper journal">
      <div className="bt-head first">
        <div>
          <h2>Trade journal</h2>
          <p>Your real trades, written down by you: what you bought, why, where you would get out, and how it went. Nothing here places an order.</p>
        </div>
        <div className="jsettings">
          <label title="The money you have set aside for trading. Used only to size positions.">Trading capital ₹<NumInput label="Trading capital" placeholder="e.g. 500000" value={journal.capital} onChange={(v) => onSave((j) => ({ ...j, capital: v != null && v > 0 ? v : null }))} /></label>
          <label title="How much of your capital you are willing to lose on one trade if the stop is hit. Many traders use 0.5% to 2%.">Risk per trade %<NumInput label="Risk per trade, percent of capital" placeholder="1" value={journal.riskPct} onChange={(v) => onSave((j) => ({ ...j, riskPct: v != null && v > 0 ? Math.min(v, 100) : 1 }))} /></label>
        </div>
      </div>

      {!empty && (
        <div className="tiles">
          <div className="tile"><span>Realised profit / loss</span><b className={tone(realised)}>{closed.length ? signedRupees(realised) : '–'}</b><small>{closed.length ? `${closed.length} closed trade${closed.length > 1 ? 's' : ''}, after charges you entered` : 'No closed trades yet'}</small></div>
          <div className="tile"><span>Trades won</span><b>{closed.length ? `${((wins.length / closed.length) * 100).toFixed(0)}%` : '–'}</b><small>{closed.length ? <>avg win {wins.length ? rupees(avg(wins.map((x) => x.pnl))!) : '–'} · avg loss {losses.length ? rupees(avg(losses.map((x) => x.pnl))!) : '–'}</> : 'None yet'}</small></div>
          <div className="tile"><span>Average result per trade <Explain term="r" /></span><b className={tone(avg(rs))}>{fmtR(avg(rs))}</b><small>{rs.length ? `Over ${rs.length} trade${rs.length > 1 ? 's' : ''} that had a stop. Above 0 means the wins outweigh the losses.` : 'Needs closed trades that had a stop'}</small></div>
          <div className="tile"><span>Open now</span><b>{rupees(invested)}</b><small className={tone(unrealised)}>{open.length} trade{open.length === 1 ? '' : 's'} · {signedRupees(unrealised)} so far</small></div>
          <div className="tile" title="What you would lose from today's prices if every stop were hit; trades without a stop count in full"><span>At risk if stops hit</span><b>{rupees(atRisk)}</b><small>{journal.capital ? `${((atRisk / journal.capital) * 100).toFixed(1)}% of your capital` : 'Enter your capital to see this as a share'}</small></div>
        </div>
      )}

      {empty && !adding ? (
        <div className="empty-card">
          <Icon name="journal" size={30} />
          <div>
            <b>Write down your first trade</b>
            <p>Enter what you bought and where your stop is. The journal works out how many shares fit your risk, tracks the trade against each day's close, and shows which kinds of trade actually make you money.</p>
          </div>
          <button className="primary" onClick={() => setAdding(true)}>Add a trade <Icon name="arrowRight" /></button>
        </div>
      ) : (
        <section className="panel">
          <div className="screen-head">
            <h3>{adding ? 'Add a trade' : 'New trade'}</h3>
            <button className="link" onClick={() => setAdding(!adding)}>{adding ? 'Hide' : 'Add a trade'}</button>
          </div>
          {adding && <NewTrade key={prefill ?? ''} journal={journal} rowOf={rowOf} asOf={asOf} prefill={prefill} onAdd={(t) => { onSave((j) => ({ ...j, trades: [...j.trades, t] })); setAdding(false); }} />}
        </section>
      )}

      {open.length > 0 && (
        <section>
          <h3>Open trades <small>{open.length}</small></h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sym">Stock</th><th>Shares</th><th>Bought at</th><th>Last close</th><th>Profit / loss</th>
                  <th>In R</th><th title="Editable. Move it up as the trade works; R is still measured from your first stop.">Stop</th><th>Target</th><th>Since</th><th />
                </tr>
              </thead>
              <tbody>
                {open.map((t) => {
                  const now = lastOf(t);
                  const pnl = now != null ? pnlOf(t, now) : null;
                  return [
                    <tr key={t.id} onClick={() => openStock(t.s)}>
                      <td className="sym wrap"><b>{t.s}</b><small>{t.setup}{t.reason && ` · ${t.reason}`}</small></td>
                      <td>{int.format(t.qty)}</td>
                      <td>{fmtPrice(t.entry)}</td>
                      <td>{fmtPrice(now)}{now != null && t.stop != null && now <= t.stop && <small className="down"> below stop</small>}</td>
                      <td className={tone(pnl)}>{pnl == null ? '–' : <><b>{signedRupees(pnl)}</b> <small>{fmtPct((now! / t.entry - 1) * 100)}</small></>}</td>
                      <td className={tone(now != null ? rOf(t, now) : null)}>{fmtR(now != null ? rOf(t, now) : null)}</td>
                      <td onClick={(e) => e.stopPropagation()}><span className="inline-edit"><NumInput label={`${t.s} stop`} placeholder="none" value={t.stop} onChange={(v) => edit(t.id, { stop: v })} /></span></td>
                      <td onClick={(e) => e.stopPropagation()}><span className="inline-edit"><NumInput label={`${t.s} target`} placeholder="none" value={t.target} onChange={(v) => edit(t.id, { target: v })} /></span></td>
                      <td>{fmtDate(t.entryDate, false)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="link" onClick={() => setClosing(closing === t.id ? null : t.id)}>I sold this</button>
                        <button className="link" onClick={() => remove(t)}>Remove</button>
                      </td>
                    </tr>,
                    closing === t.id && (
                      <tr key={`${t.id}-close`} className="static">
                        <td colSpan={10} className="left">
                          <CloseTrade trade={t} last={now} asOf={asOf} onCancel={() => setClosing(null)} onDone={(patch) => { edit(t.id, patch); setClosing(null); }} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {setups.length > 0 && (
        <section>
          <h3>What works for you <small>closed trades by kind</small></h3>
          <div className="table-wrap">
            <table className="static">
              <thead><tr><th className="sym">Kind of trade</th><th>Trades</th><th>Won</th><th>Average result</th><th>Profit / loss</th></tr></thead>
              <tbody>
                {setups.map((x) => (
                  <tr key={x.name}>
                    <td className="sym"><b>{x.name}</b></td>
                    <td>{x.n}</td>
                    <td>{x.won.toFixed(0)}%</td>
                    <td className={tone(x.r)}>{fmtR(x.r)}</td>
                    <td className={tone(x.pnl)}><b>{signedRupees(x.pnl)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {closed.length < 20 && <p className="note">With {closed.length} closed trade{closed.length > 1 ? 's' : ''}, these figures are mostly luck. They start to mean something after 20 to 30.</p>}
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <h3>Closed trades <small>{closed.length}</small></h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th className="sym">Stock</th><th>Shares</th><th>Bought</th><th>Sold</th><th>Profit / loss</th><th>In R</th><th>Held</th><th className="left">What you learned</th><th /></tr></thead>
              <tbody>
                {results.map(({ t, pnl, r }) => (
                  <tr key={t.id} onClick={() => openStock(t.s)}>
                    <td className="sym wrap"><b>{t.s}</b><small>{t.setup}{t.reason && ` · ${t.reason}`}</small></td>
                    <td>{int.format(t.qty)}</td>
                    <td>{fmtPrice(t.entry)} <small className="muted">{fmtDate(t.entryDate, false)}</small></td>
                    <td>{fmtPrice(t.exit)} <small className="muted">{fmtDate(t.exitDate!, false)}</small></td>
                    <td className={tone(pnl)}><b>{signedRupees(pnl)}</b> <small>{fmtPct((t.exit! / t.entry - 1) * 100)}</small></td>
                    <td className={tone(r)}>{fmtR(r)}</td>
                    <td>{daysBetween(t.entryDate, t.exitDate!)} d</td>
                    <td className="left lesson">{t.lesson || <span className="muted">–</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="link" onClick={() => edit(t.id, { exit: undefined, exitDate: undefined, fees: undefined, lesson: undefined })}>Reopen</button>
                      <button className="link" onClick={() => remove(t)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="note disclaimer">
        The journal only knows what you type in. Open trades are valued at the latest closing price, and profit includes charges only where you entered them. The suggested number of shares is arithmetic on your own capital, risk and stop; it is not advice to buy.
      </p>
    </div>
  );
}
