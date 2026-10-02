// Chart pattern detection on daily bars. Each pattern is a fixed, mechanical
// rule, so the same code drives the screener, the chart overlay and the
// backtests. They are deliberately strict definitions of loosely described
// shapes; a chartist would accept some charts these reject, and the reverse.
//
//   tightBase  price has gone quiet near its highs after a run-up (a
//              "volatility contraction"): narrow range, falling volume
//   baseBreak  first close above a 5-week sideways range, on volume
//   flag       a sharp run-up followed by a shallow, quiet pullback
//   cup        a rounded decline and recovery to the old high, then a small
//              pullback (the handle)
//   dblBottom  two similar lows, then a close above the peak between them

export const PATTERNS = ['tightBase', 'baseBreak', 'flag', 'cup', 'dblBottom'];

/**
 * @param bars adjusted daily bars, oldest first: { date, o, h, l, c, v }
 * @returns { flags: { [pattern]: Uint8Array }, latest: [{ code, from, level, low }] }
 *          `latest` describes the patterns present on the final bar, for drawing.
 */
export function detectPatterns(bars) {
  const n = bars.length;
  const flags = Object.fromEntries(PATTERNS.map((p) => [p, new Uint8Array(n)]));
  const latest = [];
  if (n < 70) return { flags, latest };

  const h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c), v = bars.map((b) => b.v);
  const pc = [0], pv = [0];
  for (let i = 0; i < n; i++) { pc.push(pc[i] + c[i]); pv.push(pv[i] + v[i]); }
  const avgV = (a, b) => (pv[b + 1] - pv[a]) / (b - a + 1);
  const sma = (k, t) => (t + 1 >= k ? (pc[t + 1] - pc[t + 1 - k]) / k : null);
  const maxAt = (arr, a, b) => { let m = a; for (let i = a + 1; i <= b; i++) if (arr[i] > arr[m]) m = i; return m; };
  const minAt = (arr, a, b) => { let m = a; for (let i = a + 1; i <= b; i++) if (arr[i] < arr[m]) m = i; return m; };
  const note = (t, code, fromIdx, level, low) => {
    flags[code][t] = 1;
    if (t === n - 1) latest.push({ code, from: bars[fromIdx].date, level: Math.round(level * 100) / 100, low: Math.round(low * 100) / 100 });
  };

  for (let t = 64; t < n; t++) {
    const s50 = sma(50, t);
    const s200 = sma(200, t);

    // --- tight base near the highs
    {
      const a = t - 14;
      const hi = h[maxAt(h, a, t)], lo = l[minAt(l, a, t)];
      const width = (hi - lo) / c[t];
      const priorWidth = (h[maxAt(h, t - 44, a - 1)] - l[minAt(l, t - 44, a - 1)]) / c[a - 1];
      const yearHigh = h[maxAt(h, Math.max(0, t - 251), t)];
      if (
        width <= 0.1 && width <= 0.6 * priorWidth &&
        c[t] >= 0.85 * yearHigh && c[t] > s50 &&
        c[t] >= 1.1 * c[t - 63] &&
        avgV(t - 9, t) <= 0.85 * avgV(t - 59, t - 10)
      ) note(t, 'tightBase', a, hi, lo);
    }

    // --- breakout from a sideways base
    {
      const a = t - 25, b = t - 1;
      const hi = h[maxAt(h, a, b)], lo = l[minAt(l, a, b)];
      if (
        (hi - lo) / lo <= 0.15 && c[t] > hi && c[b] <= hi &&
        v[t] >= 1.5 * avgV(t - 20, b) && c[t] > (s200 ?? s50)
      ) note(t, 'baseBreak', a, hi, lo);
    }

    // --- bull flag: pole, then a shallow quiet pullback
    for (let k = 4; k <= 12; k++) {
      const p = t - k;
      if (p - 10 < 0) break;
      if (maxAt(h, p - 10, p) !== p) continue; // the pole must end at its high
      const lowIdx = minAt(l, p - 10, p);
      const pole = h[p] - l[lowIdx];
      if (h[p] / l[lowIdx] - 1 < 0.18 || lowIdx === p) continue;
      const flagLow = l[minAt(l, p + 1, t)];
      if (
        h[maxAt(h, p + 1, t)] <= h[p] * 1.01 &&
        flagLow >= h[p] - 0.5 * pole && flagLow >= h[p] * 0.88 &&
        avgV(p + 1, t) <= 0.8 * avgV(lowIdx, p)
      ) {
        note(t, 'flag', lowIdx, h[p], flagLow);
        break;
      }
    }

    // --- cup with handle
    if (t >= 60) {
      const r = maxAt(h, t - 15, t - 3); // right rim
      if (r - 25 >= 0) {
        const li = maxAt(h, Math.max(0, r - 120), r - 25); // left rim
        const bi = minAt(l, li, r);
        const depth = 1 - l[bi] / h[li];
        const handleLow = l[minAt(l, r + 1, t)];
        if (
          Math.abs(h[li] / h[r] - 1) <= 0.06 && depth >= 0.12 && depth <= 0.35 &&
          bi >= li + 8 && bi <= r - 8 &&
          handleLow >= h[r] * 0.9 && handleLow >= l[bi] + 0.5 * (h[r] - l[bi]) &&
          c[t] <= h[r] * 1.02 && avgV(r + 1, t) <= avgV(li, r)
        ) note(t, 'cup', li, h[r], l[bi]);
      }
    }

    // --- double bottom, confirmed by a close above the middle peak
    if (t >= 110) {
      const b2 = minAt(l, t - 15, t - 2);
      const b1 = minAt(l, b2 - 45, b2 - 8);
      const pk = maxAt(h, b1, b2);
      const floor = Math.max(l[b1], l[b2]);
      if (
        Math.abs(l[b1] / l[b2] - 1) <= 0.035 && h[pk] / floor - 1 >= 0.08 &&
        h[maxAt(h, b1 - 40, b1)] >= 1.15 * l[b1] &&
        c[t] > h[pk] && c[t - 1] <= h[pk]
      ) note(t, 'dblBottom', b1, h[pk], Math.min(l[b1], l[b2]));
    }
  }
  return { flags, latest };
}
