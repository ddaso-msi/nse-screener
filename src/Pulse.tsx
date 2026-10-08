import { useEffect, useState } from 'react';
import { fmtDate, fmtPct, fmtPrice, monthOf } from './data';
import { Explain } from './Help';
import { tone } from './ui';

interface Flow { d: number; fii: number | null; dii: number | null }
interface Valuation { name: string; pe: number; pb: number | null; dy: number | null; pct: number; lo: number; hi: number; mid: number; days: number; from: number }
interface Deal { d: number; s: string; name: string; who: string; side: 'B' | 'S'; qty: number; px: number; kind: 'bulk' | 'block'; cr: number }
interface Reported { s: string; name: string; q: number; at: number; rev: number; pat: number; revYoY: number | null; patYoY: number | null; move: number | null; mcap: number | null }
interface PulseData { asOf: number; flows: Flow[]; valuation: Valuation[]; dealDay: number; deals: Deal[]; reported: Reported[] }

function usePulse() {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  useEffect(() => {
    fetch(`/data/pulse.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setPulse).catch(() => {});
  }, []);
  return pulse;
}

const crores = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')} Cr`;
const years = (days: number) => (days >= 400 ? `${(days / 250).toFixed(1)} years` : `${Math.round(days / 21)} months`);

function FlowTile({ label, flows, pick }: { label: string; flows: Flow[]; pick: (f: Flow) => number | null }) {
  const series = flows.map(pick).filter((v): v is number => v != null);
  const today = series[series.length - 1];
  if (today == null) return null;
  const recent = series.slice(-20);
  const max = Math.max(...recent.map(Math.abs), 1);
  const total = recent.reduce((s, v) => s + v, 0);
  return (
    <div className="tile">
      <span>{label}</span>
      <b className={tone(today)}>{crores(today)}</b>
      {recent.length >= 5 ? (
        <>
          <div className="flowbars" aria-hidden>{recent.map((v, i) => <i key={i} className={v < 0 ? 'neg' : ''} style={{ height: `${Math.max(8, (Math.abs(v) / max) * 100)}%` }} />)}</div>
          <small>{crores(total)} over the last {recent.length} sessions</small>
        </>
      ) : (
        <small>{today > 0 ? 'Net bought' : 'Net sold'} today. A trend appears here after a few sessions; Sensa started recording on {fmtDate(flows[0].d, false)}.</small>
      )}
    </div>
  );
}

/** For the brief: institutional flows, how expensive the indices are, and the day's large trades. */
export function Pulse({ onOpenStock }: { onOpenStock: (s: string) => void }) {
  const pulse = usePulse();
  const [allDeals, setAllDeals] = useState(false);
  if (!pulse) return null;
  const nifty = pulse.valuation.find((v) => v.name === 'Nifty 50');
  const deals = allDeals ? pulse.deals : pulse.deals.slice(0, 8);
  const lastFlow = pulse.flows[pulse.flows.length - 1];
  return (
    <>
      {(lastFlow || nifty) && (
        <section className="panel pulse">
          <h3>Money and valuation <small>{lastFlow && `institutional flows for ${fmtDate(lastFlow.d, false)}`}</small></h3>
          <div className="tiles">
            {lastFlow && <FlowTile label="Foreign institutions (FII), cash market" flows={pulse.flows} pick={(f) => f.fii} />}
            {lastFlow && <FlowTile label="Domestic institutions (DII), cash market" flows={pulse.flows} pick={(f) => f.dii} />}
            {nifty && (
              <div className="tile">
                <span>Nifty 50 P/E <Explain term="valuation" /></span>
                <b>{nifty.pe.toFixed(1)}</b>
                <div className="valbar" title={`Range ${nifty.lo}–${nifty.hi}, middle ${nifty.mid}`}><i style={{ left: `calc(${((nifty.pe - nifty.lo) / (nifty.hi - nifty.lo || 1)) * 100}% - 1px)` }} /></div>
                <small>{nifty.pct === 0 ? 'The lowest' : nifty.pct >= 99 ? 'The highest' : `Higher than on ${nifty.pct}% of days`} in the last {years(nifty.days)} (range {nifty.lo.toFixed(1)}–{nifty.hi.toFixed(1)})</small>
              </div>
            )}
          </div>
          {pulse.valuation.length > 1 && (
            <div className="table-wrap">
              <table className="static">
                <thead><tr><th className="left">Index</th><th>P/E</th><th title="Share of days in the period on which the P/E was lower than today">Dearer than</th><th>Range</th><th>P/B</th><th>Dividend yield</th></tr></thead>
                <tbody>
                  {pulse.valuation.map((v) => (
                    <tr key={v.name}>
                      <td className="left">{v.name}</td>
                      <td><b>{v.pe.toFixed(1)}</b></td>
                      <td>{v.pct === 0 ? 'no day (the lowest)' : `${v.pct}% of days`}</td>
                      <td className="muted">{v.lo.toFixed(1)}–{v.hi.toFixed(1)}</td>
                      <td>{v.pb?.toFixed(2) ?? '–'}</td>
                      <td>{v.dy == null ? '–' : `${v.dy.toFixed(2)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="note">
            <Explain term="flows" /> Flows are the exchanges' provisional figures. "Dearer than" compares each index's P/E with its own past {nifty ? years(nifty.days) : 'period'} only (since {nifty ? `${monthOf(nifty.from)} ${Math.floor(nifty.from / 10000)}` : 'Sensa has data'}), which is a short memory: a high reading means dear by recent standards, not a forecast.
          </p>
        </section>
      )}

      {pulse.deals.length > 0 && (
        <section className="panel pulse">
          <div className="screen-head">
            <h3>Large trades <Explain term="deals" /> <small>{pulse.deals.length} on {fmtDate(pulse.dealDay, false)}, largest first</small></h3>
            {pulse.deals.length > 8 && <button className="link" onClick={() => setAllDeals(!allDeals)}>{allDeals ? 'Show fewer' : `Show all ${pulse.deals.length}`}</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th className="sym">Stock</th><th className="left">Who</th><th>Side</th><th>Value</th><th>Price</th><th>Type</th></tr></thead>
              <tbody>
                {deals.map((d, i) => (
                  <tr key={i} onClick={() => onOpenStock(d.s)}>
                    <td className="sym"><b>{d.s}</b><small>{d.name}</small></td>
                    <td className="left">{d.who}</td>
                    <td className={d.side === 'B' ? 'up' : 'down'}><b>{d.side === 'B' ? 'Bought' : 'Sold'}</b></td>
                    <td>₹{d.cr.toFixed(d.cr >= 100 ? 0 : 1)} Cr</td>
                    <td>{fmtPrice(d.px)}</td>
                    <td className="muted">{d.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Many of these are trading firms buying and selling the same day, or one fund passing shares to another. A named long-term investor on one side is the part worth noticing.</p>
        </section>
      )}
    </>
  );
}

/** For the News tab: companies that reported results in the last three weeks, and how the stock took it. */
export function ResultsTracker({ onOpenStock }: { onOpenStock: (s: string) => void }) {
  const pulse = usePulse();
  const [all, setAll] = useState(false);
  if (!pulse?.reported.length) return null;
  const shown = all ? pulse.reported : pulse.reported.slice(0, 12);
  return (
    <section className="panel pulse results-tracker">
      <div className="screen-head">
        <h3>Results just out <small>{pulse.reported.length} companies in the last three weeks, newest first</small></h3>
        {pulse.reported.length > 12 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${pulse.reported.length}`}</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sym">Company</th><th>Filed</th><th>Quarter to</th><th>Sales ₹ Cr</th><th>Sales growth</th><th>Profit ₹ Cr</th><th>Profit growth</th>
              <th title="The stock's move on the first session that could react to the filing">Stock's reaction</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.s} onClick={() => onOpenStock(r.s)}>
                <td className="sym"><b>{r.s}</b><small>{r.name}</small></td>
                <td>{fmtDate(r.at, false)}</td>
                <td>{monthOf(r.q)} {Math.floor(r.q / 10000)}</td>
                <td>{Math.round(r.rev).toLocaleString('en-IN')}</td>
                <td className={tone(r.revYoY)}>{fmtPct(r.revYoY, 0)}</td>
                <td className={r.pat < 0 ? 'down' : ''}>{Math.round(r.pat).toLocaleString('en-IN')}</td>
                <td className={tone(r.patYoY)}>{fmtPct(r.patYoY, 0)}</td>
                <td className={tone(r.move)}>{r.move == null ? <span className="muted">not traded yet</span> : <b>{fmtPct(r.move)}</b>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Growth compares with the same quarter a year earlier; it is blank where that quarter hasn't been read yet or was a loss. The reaction is one day's move and includes whatever the whole market did that day.</p>
    </section>
  );
}
