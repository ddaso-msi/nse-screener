import { useEffect, useState } from 'react';
import { fmtDate } from './data';
import { Explain } from './Help';

interface OddsLine {
  topic: string;
  title: string;
  /** Which outcome the chance refers to; null when the question is a plain yes/no */
  detail: string | null;
  /** Chance, 0 to 1 */
  p: number;
  /** Change over a day and a week, in the same units (0.02 = 2 points) */
  d1: number | null;
  w1: number | null;
  vol: number;
  end: number;
}
interface OddsData { asOf: number; fetchedAt: string; lines: OddsLine[] }

const chance = (p: number) => (p < 0.01 ? '<1%' : p > 0.99 ? '>99%' : `${Math.round(p * 100)}%`);
const points = (d: number | null) => (d == null || Math.abs(d) < 0.005 ? '–' : `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(0)} pts`);

/** A few lines for the brief: what prediction markets expect on the outside events that move Indian stocks. */
export function MacroBackdrop() {
  const [odds, setOdds] = useState<OddsData | null>(null);
  useEffect(() => {
    fetch('/data/odds.json').then((r) => (r.ok ? r.json() : Promise.reject())).then(setOdds).catch(() => {});
  }, []);
  if (!odds?.lines?.length) return null;
  return (
    <section className="panel backdrop">
      <h3>Macro backdrop <Explain term="odds" /> <small>what prediction markets expect · Polymarket, evening of {fmtDate(odds.asOf, false)}</small></h3>
      <div className="table-wrap">
        <table className="static">
          <thead><tr><th className="left">Topic</th><th className="sym">Question</th><th>Chance</th><th title="Change over the last day, in percentage points">Day</th><th title="Change over the last week, in percentage points">Week</th><th>Decided by</th></tr></thead>
          <tbody>
            {odds.lines.map((l) => (
              <tr key={l.title + l.detail}>
                <td className="left muted">{l.topic}</td>
                <td className="sym wrap">{l.title}{l.detail && <> <b>{l.detail}</b></>}</td>
                <td><b>{chance(l.p)}</b></td>
                {/* no green or red: a rising chance of a rate hike or a war is not "good" */}
                <td>{points(l.d1)}</td>
                <td>{points(l.w1)}</td>
                <td>{fmtDate(l.end, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Background, not a signal: Indian prices usually reflect these shifts by the next open. The odds are a snapshot from the evening update and move all day.</p>
    </section>
  );
}
