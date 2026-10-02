// Moves a paper-trading account forward to the latest session. It runs in the
// browser, from the same price files the charts use, so every user's account
// is worked out on their own device and nothing per-user runs on the server.
//
// One session at a time: orders fill at the next session's open, then stops
// and targets are checked against each day's range. A stop and a target
// touched on the same day count as the stop; a gap through a level fills at
// the open.

import { fileSafe, type History } from './data';
import { PAPER_FEE, type Paper, type PaperPosition } from './user';

const round = (x: number) => Math.round(x * 100) / 100;

interface Prices { h: History; at: Map<number, number> }

async function load(symbol: string): Promise<Prices | null> {
  try {
    const res = await fetch(`/data/h/${fileSafe(symbol)}.json`);
    if (!res.ok) return null;
    const h: History = await res.json();
    return { h, at: new Map(h.d.map((d, i) => [d, i])) };
  } catch {
    return null;
  }
}

/** Returns the advanced account, or null when it is already up to date. */
export async function advancePaper(input: Paper, asOf: number): Promise<Paper | null> {
  if (input.last != null && input.last >= asOf) return null;
  const paper: Paper = structuredClone(input);
  paper.notices ??= [];

  const index: { d: number[]; c: number[] } | undefined = await fetch('/data/idx.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((x: Record<string, { d: number[]; c: number[] }>) => x['Nifty 50'])
    .catch(() => undefined);
  const niftyOn = new Map((index?.d ?? []).map((d, i) => [d, index!.c[i]]));

  if (paper.last == null) {
    paper.last = asOf;
    paper.equity = [{ date: asOf, value: paper.cash, nifty: niftyOn.get(asOf) ?? null }];
    return paper;
  }

  const symbols = [...new Set([...paper.orders, ...paper.positions].map((x) => x.s))];
  const prices = new Map<string, Prices>();
  for (const [s, p] of await Promise.all(symbols.map(async (s) => [s, await load(s)] as const))) if (p) prices.set(s, p);

  // sessions since the last update: from the index if we have it, else from the stocks held
  const sessions = (index?.d ?? [...new Set([...prices.values()].flatMap((p) => p.h.d))].sort((a, b) => a - b)).filter((d) => d > paper.last! && d <= asOf);

  // a split or bonus since entry changes the price scale: restate the position to match
  for (const p of paper.positions) {
    const px = prices.get(p.s);
    const i = px?.at.get(p.entryDate);
    if (!px || i == null || !p.ref) continue;
    const k = px.h.c[i] / p.ref;
    if (Math.abs(k - 1) > 0.005) {
      p.entry = round(p.entry * k);
      if (p.stop) p.stop = round(p.stop * k);
      if (p.target) p.target = round(p.target * k);
      p.qty = Math.round(p.qty / k);
      p.ref = px.h.c[i];
    }
  }

  const close = (p: PaperPosition, price: number, date: number, reason: string) => {
    const proceeds = price * p.qty * (1 - PAPER_FEE);
    const cost = p.entry * p.qty * (1 + PAPER_FEE);
    paper.cash = round(paper.cash + proceeds);
    paper.closed.unshift({
      s: p.s, qty: p.qty, entry: p.entry, entryDate: p.entryDate, exit: round(price), exitDate: date, reason,
      pnl: round(proceeds - cost), pct: round((proceeds / cost - 1) * 100), note: p.note ?? '',
    });
    paper.positions = paper.positions.filter((x) => x !== p);
  };

  for (const d of sessions) {
    for (const p of [...paper.positions]) {
      const px = prices.get(p.s);
      const t = px?.at.get(d);
      if (!px || t == null) continue; // not traded that day
      const { o, h, l } = px.h;
      if (p.sell && p.sell < d) close(p, o[t], d, 'Sold at the open');
      else if (p.stop && o[t] <= p.stop) close(p, o[t], d, 'Stop hit on a gap down');
      else if (p.stop && l[t] <= p.stop) close(p, p.stop, d, 'Stop hit');
      else if (p.target && o[t] >= p.target) close(p, o[t], d, 'Target hit on a gap up');
      else if (p.target && h[t] >= p.target) close(p, p.target, d, 'Target hit');
    }
    for (const order of [...paper.orders]) {
      if (order.placed >= d) continue;
      const px = prices.get(order.s);
      const t = px?.at.get(d);
      if (!px || t == null) continue;
      paper.orders = paper.orders.filter((x) => x !== order);
      const price = px.h.o[t];
      const qty = Math.min(order.qty, Math.floor(paper.cash / (price * (1 + PAPER_FEE))));
      if (qty <= 0) {
        paper.notices.unshift({ date: d, text: `${order.s}: order not filled, not enough cash` });
        continue;
      }
      if (qty < order.qty) paper.notices.unshift({ date: d, text: `${order.s}: bought ${qty} of ${order.qty}, cash ran out` });
      paper.cash = round(paper.cash - price * qty * (1 + PAPER_FEE));
      const pos: PaperPosition = { id: order.id, s: order.s, qty, entry: round(price), entryDate: d, ref: px.h.c[t], stop: order.stop ?? null, target: order.target ?? null, note: order.note ?? '' };
      paper.positions.push(pos);
      if (pos.stop && px.h.l[t] <= pos.stop) close(pos, pos.stop, d, 'Stop hit');
      else if (pos.target && px.h.h[t] >= pos.target) close(pos, pos.target, d, 'Target hit');
    }
    let value = paper.cash;
    for (const p of paper.positions) {
      const px = prices.get(p.s);
      let last = p.entry;
      if (px) for (let i = px.h.d.length - 1; i >= 0; i--) if (px.h.d[i] <= d) { last = px.h.c[i]; break; }
      value += p.qty * last;
    }
    paper.equity.push({ date: d, value: round(value), nifty: niftyOn.get(d) ?? null });
  }
  paper.notices = paper.notices.slice(0, 12);
  paper.last = asOf;
  return paper;
}
