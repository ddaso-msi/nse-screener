// Option pricing maths for the Options tab (Black-Scholes on the forward the
// chain itself implies, so calls and puts at one strike agree).

export interface OptionHead {
  s: string;
  name: string;
  index: boolean;
  spot: number;
  chg: number | null;
  lot: number | null;
  iv: number | null;
  ivRank: number | null;
  pcr: number | null;
  oi: number;
  expiries: number[];
}
/** [strike, callPrice, callOi, callOiChg, callVol, callIv, putPrice, putOi, putOiChg, putVol, putIv] */
export type StrikeRow = [number, number | null, number, number, number, number | null, number | null, number, number, number, number | null];
export interface Expiry {
  date: number;
  days: number;
  fwd: number;
  fut: { price: number; oi: number; chg: number } | null;
  atmIv: number | null;
  pcr: number | null;
  maxPain: number | null;
  callOi: number;
  putOi: number;
  strikes: StrikeRow[];
}
export interface Chain extends Omit<OptionHead, 'expiries'> {
  asOf: number;
  expiries: Expiry[];
}

export interface Leg {
  id: number;
  kind: 'C' | 'P' | 'F';
  strike: number;
  /** +1 bought, -1 sold */
  side: 1 | -1;
  lots: number;
  /** premium per share (or futures price) at entry */
  price: number;
  /** implied volatility, %, used to value the leg before expiry */
  iv: number;
}

export const cdf = (x: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
const pdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

/** Option value per share. S is the forward discounted to today; v is volatility as a fraction; T in years. */
export function value(call: boolean, S: number, K: number, T: number, v: number, r: number) {
  if (T <= 0 || v <= 0) return Math.max(0, call ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);
  return call ? S * cdf(d1) - K * Math.exp(-r * T) * cdf(d2) : K * Math.exp(-r * T) * cdf(-d2) - S * cdf(-d1);
}

export interface Greeks { delta: number; gamma: number; theta: number; vega: number }
/** Per share: delta, gamma, theta per calendar day, vega per one volatility point. */
export function greeks(call: boolean, S: number, K: number, T: number, v: number, r: number): Greeks {
  if (T <= 0 || v <= 0) return { delta: call ? (S > K ? 1 : 0) : S < K ? -1 : 0, gamma: 0, theta: 0, vega: 0 };
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * sq);
  const d2 = d1 - v * sq;
  const decay = (-S * pdf(d1) * v) / (2 * sq);
  const carry = r * K * Math.exp(-r * T) * (call ? cdf(d2) : cdf(-d2));
  return {
    delta: call ? cdf(d1) : cdf(d1) - 1,
    gamma: pdf(d1) / (S * v * sq),
    theta: (decay + (call ? -carry : carry)) / 365,
    vega: (S * pdf(d1) * sq) / 100,
  };
}

export interface Position {
  /** P&L in ₹ at expiry for an underlying price */
  atExpiry: (x: number) => number;
  /** P&L in ₹ `daysAhead` days from now for an underlying price */
  onDay: (x: number, daysAhead: number) => number;
  /** Positive = paid (debit), negative = received (credit) */
  premium: number;
  maxProfit: number | null; // null = unlimited
  maxLoss: number | null; // null = unlimited
  breakevens: number[];
  /** Chance of any profit at expiry under a lognormal price with the at-the-money IV. A model figure, not a forecast. */
  pop: number | null;
  net: Greeks;
}

export function analyse(legs: Leg[], spot: number, exp: Expiry, lot: number, rate: number): Position {
  const T = Math.max(exp.days, 0.5) / 365;
  const basis = exp.fwd / spot; // forward per unit of spot
  const qty = (l: Leg) => l.side * l.lots * lot;

  const atExpiry = (x: number) =>
    legs.reduce((sum, l) => {
      const unit = l.kind === 'F' ? x - l.price : Math.max(0, l.kind === 'C' ? x - l.strike : l.strike - x) - l.price;
      return sum + qty(l) * unit;
    }, 0);

  const onDay = (x: number, daysAhead: number) => {
    const left = Math.max(0, exp.days - daysAhead) / 365;
    if (left <= 0) return atExpiry(x);
    // the forward converges on the spot as expiry approaches
    const fwd = x * (1 + (basis - 1) * (left / T));
    const S = fwd * Math.exp(-rate * left);
    return legs.reduce((sum, l) => {
      const now = l.kind === 'F' ? fwd : value(l.kind === 'C', S, l.strike, left, l.iv / 100, rate);
      return sum + qty(l) * (now - l.price);
    }, 0);
  };

  // the expiry payoff is straight lines between strikes, so the strikes are the only places it can turn
  const nodes = [...new Set(legs.filter((l) => l.kind !== 'F').map((l) => l.strike))].sort((a, b) => a - b);
  const far = Math.max(spot, nodes[nodes.length - 1] ?? spot) * 3;
  const xs = [0, ...nodes, far];
  const ys = xs.map(atExpiry);
  const slopeRight = legs.reduce((s, l) => s + (l.kind === 'P' ? 0 : qty(l)), 0);
  const maxProfit = slopeRight > 0 ? null : Math.max(...ys);
  const maxLoss = slopeRight < 0 ? null : Math.min(...ys);

  const breakevens: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const a = ys[i - 1], b = ys[i];
    if (a === 0 && i === 1) continue;
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) breakevens.push(xs[i - 1] + ((0 - a) / (b - a)) * (xs[i] - xs[i - 1]));
  }
  if (slopeRight !== 0) {
    // one more crossing may lie beyond the last strike
    const last = xs[xs.length - 2], yLast = ys[ys.length - 2];
    const x0 = last - yLast / slopeRight;
    if (x0 > far) breakevens.push(x0);
  }

  let pop: number | null = null;
  const v = (exp.atmIv ?? 0) / 100;
  if (v > 0 && legs.length) {
    const below = (x: number) => (x <= 0 ? 0 : cdf((Math.log(x / exp.fwd) + (v * v * T) / 2) / (v * Math.sqrt(T))));
    const cuts = [0, ...breakevens.filter((b) => b > 0), Infinity];
    pop = 0;
    for (let i = 1; i < cuts.length; i++) {
      const mid = cuts[i] === Infinity ? cuts[i - 1] * 1.5 + 1 : (cuts[i - 1] + cuts[i]) / 2;
      if (atExpiry(mid) > 0) pop += (cuts[i] === Infinity ? 1 : below(cuts[i])) - below(cuts[i - 1]);
    }
    pop *= 100;
  }

  const S = exp.fwd * Math.exp(-rate * T);
  const net = legs.reduce<Greeks>(
    (g, l) => {
      const q = qty(l);
      if (l.kind === 'F') return { ...g, delta: g.delta + q };
      const x = greeks(l.kind === 'C', S, l.strike, T, l.iv / 100, rate);
      return { delta: g.delta + q * x.delta, gamma: g.gamma + q * x.gamma, theta: g.theta + q * x.theta, vega: g.vega + q * x.vega };
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 },
  );

  const premium = legs.reduce((s, l) => s + (l.kind === 'F' ? 0 : qty(l) * l.price), 0);
  return { atExpiry, onDay, premium, maxProfit, maxLoss, breakevens, pop, net };
}

export interface Template { id: string; label: string; hint: string; legs: (rows: StrikeRow[], atm: number, width: number) => Omit<Leg, 'id' | 'lots'>[] }

const nearest = (rows: StrikeRow[], target: number) => rows.reduce((best, r) => (Math.abs(r[0] - target) < Math.abs(best[0] - target) ? r : best), rows[0]);
const leg = (r: StrikeRow, kind: 'C' | 'P', side: 1 | -1): Omit<Leg, 'id' | 'lots'> => ({
  kind, side, strike: r[0],
  price: (kind === 'C' ? r[1] : r[6]) ?? 0,
  iv: (kind === 'C' ? r[5] : r[10]) ?? (kind === 'C' ? r[10] : r[5]) ?? 20,
});

/** Common structures, built around the at-the-money strike and one expected move (`width`). */
export const TEMPLATES: Template[] = [
  { id: 'call', label: 'Buy call', hint: 'Gains if the price rises. Loss limited to the premium.', legs: (r, a) => [leg(nearest(r, a), 'C', 1)] },
  { id: 'put', label: 'Buy put', hint: 'Gains if the price falls. Loss limited to the premium.', legs: (r, a) => [leg(nearest(r, a), 'P', 1)] },
  { id: 'bull', label: 'Bull call spread', hint: 'Buy a call, sell a higher one. Cheaper than a call, with capped profit.', legs: (r, a, w) => [leg(nearest(r, a), 'C', 1), leg(nearest(r, a + w), 'C', -1)] },
  { id: 'bear', label: 'Bear put spread', hint: 'Buy a put, sell a lower one. Cheaper than a put, with capped profit.', legs: (r, a, w) => [leg(nearest(r, a), 'P', 1), leg(nearest(r, a - w), 'P', -1)] },
  { id: 'straddle', label: 'Long straddle', hint: 'Buy a call and a put at the same strike. Gains from a big move either way.', legs: (r, a) => [leg(nearest(r, a), 'C', 1), leg(nearest(r, a), 'P', 1)] },
  { id: 'strangle', label: 'Short strangle', hint: 'Sell a call above and a put below. Keeps the premium if the price stays between; losses are unlimited beyond.', legs: (r, a, w) => [leg(nearest(r, a + w), 'C', -1), leg(nearest(r, a - w), 'P', -1)] },
  { id: 'condor', label: 'Iron condor', hint: 'A short strangle with further-out options bought as protection, so the loss is capped.', legs: (r, a, w) => [leg(nearest(r, a + w), 'C', -1), leg(nearest(r, a + 2 * w), 'C', 1), leg(nearest(r, a - w), 'P', -1), leg(nearest(r, a - 2 * w), 'P', 1)] },
];
