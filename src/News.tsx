import { useEffect, useMemo, useState } from 'react';
import { fmtDate, type Row } from './data';
import { Delta, Icon } from './ui';
import type { Watchlist } from './user';

interface Headline { at: number; title: string; link: string; source: string; blurb: string }
interface Filing { date: number; s: string; name: string; subject: string; text: string }
interface Meeting { s: string; name: string; date: number; purpose: string; results: boolean }
interface NewsData { asOf: number; generatedAt: string; headlines: Headline[]; filings: Filing[]; calendar: Meeting[] }

function ago(at: number, now: number) {
  const mins = Math.max(1, Math.round((now - at) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function News({ watchlist, rowOf, onOpenStock }: {
  watchlist: Watchlist;
  rowOf: Map<string, Row>;
  onOpenStock: (s: string) => void;
}) {
  const [news, setNews] = useState<NewsData | null>(null);
  const [missing, setMissing] = useState(false);
  const [source, setSource] = useState('All');
  const [scope, setScope] = useState<'liquid' | 'watch' | 'all'>('liquid');
  const [resultsOnly, setResultsOnly] = useState(true);

  useEffect(() => {
    fetch(`/data/news.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setNews)
      .catch(() => setMissing(true));
  }, []);

  const sources = useMemo(() => ['All', ...new Set(news?.headlines.map((h) => h.source) ?? [])], [news]);
  if (missing) return <div className="bt empty-app"><p>No news has been collected yet. It is gathered each time the data refreshes.</p></div>;
  if (!news) return <div className="bt" />;

  const now = Date.parse(news.generatedAt);
  const headlines = news.headlines.filter((h) => source === 'All' || h.source === source);
  const inScope = (s: string) =>
    scope === 'all' ? true : scope === 'watch' ? !!watchlist[s] : (rowOf.get(s)?.avgTurnover ?? 0) >= 5 || !!watchlist[s];
  const filings = news.filings.filter((f) => inScope(f.s));
  const calendar = news.calendar.filter((m) => inScope(m.s) && (!resultsOnly || m.results));
  const days = [...new Set(calendar.map((m) => m.date))].slice(0, 12);

  const stock = (s: string, name: string) => {
    const r = rowOf.get(s);
    return (
      <button className="stock-link" onClick={() => onOpenStock(s)} title={name}>
        {watchlist[s] && <span className="star on">★</span>}
        <b>{s}</b>
        {r && <Delta value={r.chg} />}
      </button>
    );
  };

  return (
    <div className="bt news">
      <div className="bt-head first">
        <div>
          <h2>News</h2>
          <p>Collected {fmtDate(news.asOf)} evening · headlines link to the publisher · filings are from NSE</p>
        </div>
        <div className="seg" role="group" aria-label="Which stocks">
          {([['liquid', 'Liquid stocks'], ['watch', 'Watchlist'], ['all', 'All stocks']] as const).map(([id, label]) => (
            <button key={id} className={scope === id ? 'on' : ''} onClick={() => setScope(id)} title={id === 'liquid' ? 'Stocks with ₹5 Cr+ daily turnover, plus your watchlist' : undefined}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="news-grid">
        <section className="panel">
          <div className="screen-head">
            <h3>Market headlines <small>{headlines.length}</small></h3>
            <div className="seg small">
              {sources.map((s) => (
                <button key={s} className={source === s ? 'on' : ''} onClick={() => setSource(s)}>{s}</button>
              ))}
            </div>
          </div>
          <ul className="headlines">
            {headlines.map((h) => (
              <li key={h.link}>
                <a href={h.link} target="_blank" rel="noreferrer">
                  <b>{h.title}</b>
                  {h.blurb && <p>{h.blurb}</p>}
                  <small>{h.source} · {ago(h.at, now)} <Icon name="arrowRight" size={11} /></small>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <div className="news-side">
          <section className="panel">
            <div className="screen-head">
              <h3>Board meetings ahead <small>{calendar.length}</small></h3>
              <label className="check"><input type="checkbox" checked={resultsOnly} onChange={(e) => setResultsOnly(e.target.checked)} /> Results only</label>
            </div>
            {calendar.length === 0 && <p className="note">None announced for these stocks.</p>}
            {days.map((d) => (
              <div className="cal-day" key={d}>
                <span>{fmtDate(d, false)}</span>
                <div>
                  {calendar.filter((m) => m.date === d).map((m) => (
                    <span key={m.s} title={`${m.name}: ${m.purpose}`}>{stock(m.s, m.name)}</span>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="panel">
            <h3>Company filings <small>{filings.length} material, last 3 sessions</small></h3>
            {filings.length === 0 && <p className="note">No material filings from these stocks.</p>}
            <ul className="filing-list">
              {filings.slice(0, 120).map((f, i) => (
                <li key={i}>
                  <div>{stock(f.s, f.name)}<span className="muted">{fmtDate(f.date, false)}</span></div>
                  <b>{f.subject}</b>
                  <p>{f.text}</p>
                </li>
              ))}
            </ul>
            {filings.length > 120 && <p className="note">Showing the first 120. Narrow to your watchlist to see fewer.</p>}
          </section>
        </div>
      </div>
      <p className="note disclaimer">Headlines are shown as published by their sources and are not checked or endorsed. A headline near a price move does not mean it caused it.</p>
    </div>
  );
}
