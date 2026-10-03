import { useMemo, useState } from 'react';
import { fmtCr, fmtDate, fmtPct, fmtPrice, sortRows, type Row } from './data';
import { Delta, Meter, RangeBar, Spark, tone } from './ui';
import { Explain } from './Help';
import type { Watchlist } from './user';

type Mode = 'trade' | 'invest';
const ORDER = ['Broad market', 'Sector and theme', 'Smart beta', 'Gold', 'Silver', 'International', 'Bonds and gilts', 'Liquid', 'Other'];
const LIQUID_MIN = 1; // ₹ Cr of average daily turnover

const pct2 = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(2)}%`);
/** What a year of the fund's charges costs on ₹1 lakh invested. */
const costOnLakh = (ter: number | null | undefined) => (ter == null ? '–' : `₹${Math.round(ter * 1000).toLocaleString('en-IN')}`);

const COLUMNS: { key: keyof Row; label: string; title?: string; cell: (r: Row) => React.ReactNode }[] = [
  { key: 'close', label: 'Price', cell: (r) => fmtPrice(r.close) },
  { key: 'chg', label: 'Day', cell: (r) => <Delta value={r.chg} /> },
  { key: 'w1', label: '1W', cell: (r) => <span className={tone(r.w1)}>{fmtPct(r.w1)}</span> },
  { key: 'm1', label: '1M', cell: (r) => <span className={tone(r.m1)}>{fmtPct(r.m1)}</span> },
  { key: 'm3', label: '3M', cell: (r) => <span className={tone(r.m3)}>{fmtPct(r.m3)}</span> },
  { key: 'm6', label: '6M', cell: (r) => <span className={tone(r.m6)}>{fmtPct(r.m6)}</span> },
  { key: 'y1', label: '1Y', cell: (r) => <span className={tone(r.y1)}>{fmtPct(r.y1)}</span> },
  { key: 'rs', label: 'RS', title: 'Relative strength among ETFs, 1–99', cell: (r) => <Meter value={r.rs} /> },
  { key: 'vs50', label: 'vs 50D', title: 'Price vs 50-day average', cell: (r) => <span className={tone(r.vs50)}>{fmtPct(r.vs50)}</span> },
  { key: 'vs200', label: 'vs 200D', title: 'Price vs 200-day average', cell: (r) => <span className={tone(r.vs200)}>{fmtPct(r.vs200)}</span> },
  {
    key: 'fromHi', label: '52W range', title: 'Where the price sits between its 52-week low and high',
    cell: (r) => <span className="range-cell"><RangeBar low={r.lo52} high={r.hi52} value={r.close} />{fmtPct(r.fromHi)}</span>,
  },
  { key: 'volX', label: 'Vol ×', title: 'Volume vs 20-session average', cell: (r) => (r.volX == null ? '–' : `${r.volX.toFixed(1)}×`) },
  { key: 'avgTurnover', label: 'Turnover', title: '20-session average daily turnover, ₹ crore', cell: (r) => fmtCr(r.avgTurnover) },
];

export function Etfs({ etfs, watchlist, onToggleWatch, onOpenStock, selected }: {
  etfs: Row[];
  watchlist: Watchlist;
  onToggleWatch: (s: string) => void;
  onOpenStock: (s: string) => void;
  selected: string | null;
}) {
  const [mode, setMode] = useState<Mode>('trade');
  const [category, setCategory] = useState('All');
  const [liquidOnly, setLiquidOnly] = useState(true);
  const [sort, setSort] = useState<[keyof Row, 1 | -1]>(['m3', -1]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of etfs) c.set(e.etf!.category, (c.get(e.etf!.category) ?? 0) + 1);
    return c;
  }, [etfs]);
  const categories = ORDER.filter((c) => counts.has(c));

  const pool = etfs.filter(
    (e) =>
      (category === 'All' ? !(mode === 'trade' && e.etf!.category === 'Liquid') : e.etf!.category === category) &&
      (!liquidOnly || e.avgTurnover >= LIQUID_MIN),
  );
  const traded = useMemo(() => sortRows(pool, sort[0], sort[1]), [pool, sort]);

  // funds that track the same thing, side by side
  const groups = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const e of pool) {
      const key = `${e.etf!.category}|${e.etf!.underlying.toLowerCase()}`;
      (by.get(key) ?? by.set(key, []).get(key)!).push(e);
    }
    return [...by.values()]
      .map((funds) => {
        funds.sort((a, b) => (a.etf!.ter ?? 99) - (b.etf!.ter ?? 99) || b.avgTurnover - a.avgTurnover);
        const mostTraded = funds.reduce((a, b) => (b.avgTurnover > a.avgTurnover ? b : a));
        return { funds, mostTraded, cheapest: funds[0], turnover: funds.reduce((s, f) => s + f.avgTurnover, 0) };
      })
      .sort((a, b) => ORDER.indexOf(a.funds[0].etf!.category) - ORDER.indexOf(b.funds[0].etf!.category) || b.turnover - a.turnover);
  }, [pool]);

  const star = (s: string) => (
    <button
      className={`star ${watchlist[s] ? 'on' : ''}`}
      aria-label={watchlist[s] ? `Remove ${s} from watchlist` : `Add ${s} to watchlist`}
      aria-pressed={!!watchlist[s]}
      onClick={(e) => { e.stopPropagation(); onToggleWatch(s); }}
    >
      {watchlist[s] ? '★' : '☆'}
    </button>
  );
  const onSort = (key: keyof Row) => setSort(([k, d]) => (k === key ? [key, d === 1 ? -1 : 1] : [key, -1]));

  return (
    <div className="bt etfs">
      <div className="bt-head first">
        <div>
          <h2>ETFs</h2>
          <p>{etfs.length} exchange-traded funds on NSE · prices from NSE, NAV and costs from AMFI</p>
        </div>
        <div className="seg" role="group" aria-label="What you want to do">
          <button className={mode === 'trade' ? 'on' : ''} onClick={() => setMode('trade')} title="Rank funds by momentum and trend">For trading</button>
          <button className={mode === 'invest' ? 'on' : ''} onClick={() => setMode('invest')} title="Compare funds that track the same index on cost and how closely they trade to their value">For long-term investing</button>
        </div>
      </div>

      <div className="expiries" role="group" aria-label="Category">
        <button className={category === 'All' ? 'on' : ''} onClick={() => setCategory('All')}>All</button>
        {categories.map((c) => (
          <button key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c} <small>{counts.get(c)}</small></button>
        ))}
        <label className="check" title="Many ETFs trade very little, which makes them hard to buy or sell at a fair price">
          <input type="checkbox" checked={liquidOnly} onChange={(e) => setLiquidOnly(e.target.checked)} /> Only funds trading ₹1 Cr+ a day
        </label>
      </div>

      {mode === 'trade' ? (
        <>
          <p className="note">{traded.length} funds, ranked like stocks. RS compares each fund with other ETFs. Liquid funds are left out unless you pick that category; they are built not to move.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sym" onClick={() => onSort('s')}>Fund{sort[0] === 's' && <i>{sort[1] === 1 ? '▲' : '▼'}</i>}</th>
                  <th className="sparkcol">3M trend</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} title={c.title} onClick={() => onSort(c.key)} className={sort[0] === c.key ? 'sorted' : ''}>
                      {c.label}{sort[0] === c.key && <i>{sort[1] === 1 ? '▲' : '▼'}</i>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {traded.map((r) => (
                  <tr key={r.s} className={r.s === selected ? 'sel' : ''} onClick={() => onOpenStock(r.s)}>
                    <td className="sym">{star(r.s)}<b>{r.s}</b><small>{r.etf!.underlying} · {r.name}</small></td>
                    <td className="sparkcol"><Spark data={r.spark} /></td>
                    {COLUMNS.map((c) => <td key={c.key} className={sort[0] === c.key ? 'sorted' : ''}>{c.cell(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {traded.length === 0 && <div className="none"><p>No funds match. Try another category, or untick the turnover filter.</p></div>}
          </div>
        </>
      ) : (
        <>
          <p className="note">
            Funds that track the same thing should return almost the same. What differs is the yearly cost, how easily you can trade it, and whether its price sits close to the value of what it holds (NAV).
          </p>
          {groups.length === 0 && <div className="none"><p>No funds match. Try another category, or untick the turnover filter.</p></div>}
          {groups.map(({ funds, mostTraded, cheapest }) => (
            <section key={`${funds[0].etf!.category}${funds[0].etf!.underlying}`} className="etf-group">
              <div className="screen-head">
                <h3>{funds[0].etf!.underlying} <small>{funds[0].etf!.category} · {funds.length} fund{funds.length === 1 ? '' : 's'}</small></h3>
                <span className="muted">1 year {fmtPct(mostTraded.y1)} · 2 years {fmtPct(mostTraded.y2)}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sym">Fund</th>
                      <th title="Total expense ratio: what the fund charges each year, as a share of your holding">Yearly cost <Explain term="ter" /></th>
                      <th title="What that cost comes to on ₹1 lakh held for a year">On ₹1 lakh</th>
                      <th title="20-session average daily turnover, ₹ crore. Higher is easier to trade.">Daily turnover</th>
                      <th title="Today's closing price against the fund's NAV. Positive means you pay more than the holdings are worth.">Price vs NAV <Explain term="nav" /></th>
                      <th title="Average gap between price and NAV over the last 60 sessions">60-day average</th>
                      <th>1 year</th>
                      <th>2 years</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((r) => (
                      <tr key={r.s} className={r.s === selected ? 'sel' : ''} onClick={() => onOpenStock(r.s)}>
                        <td className="sym">
                          {star(r.s)}<b>{r.s}</b>
                          {funds.length > 1 && r === cheapest && r.etf!.ter != null && <mark className="hi">Lowest cost</mark>}
                          {funds.length > 1 && r === mostTraded && <mark className="ex">Most traded</mark>}
                          <small>{r.name}</small>
                        </td>
                        <td><b>{pct2(r.etf!.ter)}</b></td>
                        <td>{costOnLakh(r.etf!.ter)}</td>
                        <td>{fmtCr(r.avgTurnover)}{r.avgTurnover < LIQUID_MIN && <mark className="lo" title="Thinly traded: the price you get may be poor">Thin</mark>}</td>
                        <td className={r.etf!.prem != null && Math.abs(r.etf!.prem) >= 1 ? 'down' : ''}>{fmtPct(r.etf!.prem, 2)}</td>
                        <td>{fmtPct(r.etf!.premAvg, 2)}</td>
                        <td className={tone(r.y1)}>{fmtPct(r.y1)}</td>
                        <td className={tone(r.y2)}>{fmtPct(r.y2)}</td>
                        <td>{fmtPrice(r.close)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <div className="method">
            <h3>How to read this</h3>
            <ul>
              <li><b>Yearly cost</b> is the fund's total expense ratio as reported to AMFI. It is taken out of the fund's value a little every day; you never pay it separately.</li>
              <li><b>Price vs NAV</b> compares the closing price with the value of the fund's holdings. A fund trading well above NAV costs you more than it is worth; overseas funds often do, because they are limited in how much new money they can take.</li>
              <li><b>Daily turnover</b> matters as much as cost. A cheap fund that barely trades can cost more to get into and out of than it saves.</li>
              <li>"Lowest cost" and "Most traded" mark facts about each group, not recommendations. Fund size, tracking error and taxes are not shown.</li>
            </ul>
          </div>
        </>
      )}
      <p className="note disclaimer">NAV as of {etfs.find((e) => e.etf!.navDate)?.etf!.navDate ? fmtDate(etfs.find((e) => e.etf!.navDate)!.etf!.navDate!) : '–'}. Expense ratios are the latest reported and can change. Not investment advice.</p>
    </div>
  );
}
