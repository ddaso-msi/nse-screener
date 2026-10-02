import { useCallback, useEffect, useRef, useState } from 'react';
import type { Filters } from './data';

export interface WatchItem {
  /** YYYYMMDD of the session it was added on */
  added: number;
  note: string;
  level: number | null;
}
export type Watchlist = Record<string, WatchItem>;
export interface BriefScreen {
  id: string;
  label: string;
  filters: Pick<Filters, 'flags' | 'ranges'> & Partial<Filters>;
}

/**
 * State kept in data/user on disk (through the dev server) so the nightly brief
 * can read it. Falls back to browser storage when there is no server.
 */
function useUserFile<T>(name: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number>();
  const latest = useRef(initial); // so back-to-back edits build on each other, not on a stale render
  const key = `nse-screener.${name}`;

  const reload = useCallback(() => {
    fetch(`/api/user/${name}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .catch(() => JSON.parse(localStorage.getItem(key) ?? 'null') ?? initial)
      .then((v) => {
        latest.current = v;
        setValue(v);
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  useEffect(reload, [reload]);

  const save = useCallback(
    (update: T | ((prev: T) => T)) => {
      const next = typeof update === 'function' ? (update as (prev: T) => T)(latest.current) : update;
      latest.current = next;
      setValue(next);
      localStorage.setItem(key, JSON.stringify(next));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        fetch(`/api/user/${name}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {});
      }, 400);
    },
    [key, name],
  );
  return [value, save, loaded, reload] as const;
}

export interface PaperOrder { id: number; s: string; qty: number; stop: number | null; target: number | null; note: string; placed: number }
export interface PaperPosition {
  id: number; s: string; qty: number; entry: number; entryDate: number; ref: number;
  stop: number | null; target: number | null; note: string;
  /** Session on which a sale at the next open was requested */
  sell?: number;
}
export interface PaperClosed { s: string; qty: number; entry: number; entryDate: number; exit: number; exitDate: number; reason: string; pnl: number; pct: number; note: string }
export interface Paper {
  start: number;
  cash: number;
  orders: PaperOrder[];
  positions: PaperPosition[];
  closed: PaperClosed[];
  equity: { date: number; value: number; nifty: number | null }[];
  notices: { date: number; text: string }[];
  last: number | null;
}
export const PAPER_FEE = 0.0015;
export const NEW_PAPER: Paper = { start: 1000000, cash: 1000000, orders: [], positions: [], closed: [], equity: [], notices: [], last: null };
export const usePaper = () => useUserFile<Paper>('paper', NEW_PAPER);

/** A line drawn on a stock's chart. Dates are YYYYMMDD so a drawing survives a change of timeframe. */
export interface Drawing { id: number; type: 'h' | 't'; d1: number; p1: number; d2?: number; p2?: number }
export const useDrawings = () => useUserFile<Record<string, Drawing[]>>('drawings', {});

export const useWatchlist = () => useUserFile<Watchlist>('watchlist', {});
export const useBriefScreens = () => useUserFile<BriefScreen[]>('screens', []);
