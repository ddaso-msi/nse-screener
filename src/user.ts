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

  useEffect(() => {
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
  return [value, save, loaded] as const;
}

export const useWatchlist = () => useUserFile<Watchlist>('watchlist', {});
export const useBriefScreens = () => useUserFile<BriefScreen[]>('screens', []);
