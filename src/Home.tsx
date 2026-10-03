import { APP_NAME, TAGLINE } from './brand';
import { fmtDate, type Dataset, type Row } from './data';
import { Icon, StockSearch, type Theme } from './ui';

const PLACES = [
  ['brief', 'Brief', 'What changed today'],
  ['screener', 'Screener', 'Find stocks by rule'],
  ['etfs', 'ETFs', 'Funds to trade or hold'],
  ['chart', 'Chart', 'Candles, indicators, drawings'],
  ['paper', 'Paper', 'Practise with virtual money'],
  ['options', 'Options', 'Chains and payoffs'],
  ['news', 'News', 'Headlines and filings'],
  ['backtest', 'Backtest', 'Test a rule on history'],
] as const;
export type Place = (typeof PLACES)[number][0];

function Mark({ size }: { size: number }) {
  return (
    <span className="logo" style={{ width: size, height: size, borderRadius: size * 0.3 }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62}>
        <path d="M3 17l5-6 4 3 6-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="5" r="2.2" fill="currentColor" />
      </svg>
    </span>
  );
}

/** The first page: the name, one line about today, a search box, and the ways in. */
export function Home({ data, searchRows, onGo, onPick, theme, onTheme, onHelp }: {
  onHelp: () => void;
  data: Dataset;
  /** Stocks and ETFs */
  searchRows: Row[];
  onGo: (place: Place) => void;
  onPick: (symbol: string) => void;
  theme: Theme;
  onTheme: () => void;
}) {
  const liquid = data.rows.filter((r: Row) => r.avgTurnover >= 1 && r.chg != null);
  const fell = liquid.filter((r) => r.chg! < 0).length;
  const share = liquid.length ? fell / liquid.length : 0.5;
  const mood = share >= 0.6 ? 'Most stocks fell' : share <= 0.4 ? 'Most stocks rose' : 'A mixed day';
  const weekday = new Date(Math.floor(data.asOf / 10000), (Math.floor(data.asOf / 100) % 100) - 1, data.asOf % 100).toLocaleDateString('en-IN', { weekday: 'long' });

  return (
    <div className="home">
      <button className="ghost square home-theme" onClick={onTheme} aria-label={`Theme: ${theme}. Click to change.`} title={`Theme: ${theme}`}>
        <Icon name={theme === 'auto' ? 'auto' : theme === 'dark' ? 'moon' : 'sun'} />
      </button>

      <main>
        <Mark size={56} />
        <h1>{APP_NAME}</h1>
        <p className="tagline">{TAGLINE}</p>

        <StockSearch rows={searchRows} onPick={onPick} />

        <button className="today" onClick={() => onGo('brief')}>
          <i />
          <span>{weekday}, {fmtDate(data.asOf)}</span>
          <b>{mood}.</b>
          <span>Read the brief</span>
          <Icon name="arrowRight" size={13} />
        </button>

        <nav aria-label="Sections">
          {PLACES.map(([id, label, blurb]) => (
            <button key={id} onClick={() => onGo(id)}>
              <Icon name={id} size={18} />
              <b>{label}</b>
              <small>{blurb}</small>
            </button>
          ))}
        </nav>
      </main>

      <footer>
        <button className="link first" onClick={onHelp}>How Sensa works</button> · End-of-day data from the NSE archive · {data.rows.length.toLocaleString('en-IN')} stocks · Not investment advice
      </footer>
    </div>
  );
}
