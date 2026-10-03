import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_NAME } from './brand';
import { GLOSSARY, type Term } from './glossary';
import { Icon } from './ui';

/** A small "?" that explains a term in one sentence. Works by tap as well as hover. */
export function Explain({ term }: { term: Term }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [title, text] = GLOSSARY[term];

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Node && button.current?.contains(e.target)) return;
      setAt(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [at]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation(); // don't sort the column or open the row underneath
    if (at) return setAt(null);
    const r = button.current!.getBoundingClientRect();
    setAt({ x: Math.min(Math.max(12, r.left + r.width / 2 - 150), window.innerWidth - 312), y: r.bottom + 8 });
  };

  return (
    <>
      <button ref={button} className="explain" onClick={toggle} aria-label={`What is ${title}?`} aria-expanded={!!at}>?</button>
      {at &&
        createPortal(
          <div className="explain-pop" role="tooltip" style={{ left: at.x, top: Math.min(at.y, window.innerHeight - 140) }}>
            <b>{title}</b>
            <p>{text}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

const STEPS: { title: string; body: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  {
    title: `Welcome to ${APP_NAME}`,
    body: `${APP_NAME} helps you study the Indian market after it closes: what changed, what is worth a look, and how your ideas would have played out. Prices update every weekday evening, around 7:45 pm.`,
    icon: 'brief',
  },
  {
    title: 'Start with the Brief',
    body: "Each evening's summary: how the market did in one line, alerts on the stocks you watch, and stocks that newly matched the brief's screens.",
    icon: 'brief',
  },
  {
    title: 'Find ideas',
    body: 'The Screener filters all NSE stocks by rules you choose, and ETFs compares funds for trading or holding. Click any row for details, and tap ☆ to add it to your watchlist.',
    icon: 'screener',
  },
  {
    title: 'Study a chart',
    body: 'The Chart tab has candles, indicators and drawing tools. Draw a level on a stock and make it your alert level; the Brief tells you when the price closes across it.',
    icon: 'chart',
  },
  {
    title: 'Practise before you trade',
    body: "Paper trading gives you ₹10 lakh of virtual money. Open a stock, press \"Paper trade this stock\", set a stop, and the order fills at the next day's opening price.",
    icon: 'paper',
  },
  {
    title: 'Go deeper when you are ready',
    body: `Options shows chains and lets you test strategies, News collects headlines and company filings, and Backtest shows how a rule did on past data. ${APP_NAME} shows data, not advice: every decision is yours.`,
    icon: 'backtest',
  },
];

/** The help panel: a short getting-started walk-through and the glossary. */
export function HelpPanel({ start, onClose, onOpenBrief }: { start: 'welcome' | 'glossary'; onClose: () => void; onOpenBrief: () => void }) {
  const [tab, setTab] = useState(start);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <div className="seg">
            <button className={tab === 'welcome' ? 'on' : ''} onClick={() => setTab('welcome')}>Getting started</button>
            <button className={tab === 'glossary' ? 'on' : ''} onClick={() => setTab('glossary')}>What the terms mean</button>
          </div>
          <button className="icon" onClick={onClose} aria-label="Close help"><Icon name="close" /></button>
        </div>

        {tab === 'welcome' ? (
          <div className="help-step" key={step}>
            <span className="help-icon"><Icon name={s.icon} size={22} /></span>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            <div className="dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((_, i) => <i key={i} className={i === step ? 'on' : ''} />)}
            </div>
            <div className="help-actions">
              {step > 0 ? <button className="plain" onClick={() => setStep(step - 1)}>Back</button> : <button className="plain" onClick={onClose}>Skip</button>}
              {last ? (
                <button className="primary" onClick={() => { onClose(); onOpenBrief(); }}>Open the Brief</button>
              ) : (
                <button className="primary" onClick={() => setStep(step + 1)}>Next</button>
              )}
            </div>
          </div>
        ) : (
          <dl className="glossary">
            {Object.values(GLOSSARY).map(([title, text]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
