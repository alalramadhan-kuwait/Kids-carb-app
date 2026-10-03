// More candidate forecasters for the lab (2026-10-03), the families short-term CGM studies compare: smoothing
// (Holt, Kalman), data-driven regression (AR, ARX with insulin and carbs), pattern matching (nearest past shapes),
// and the open-source closed loops' prediction (Loop: momentum + effects + retrospective correction; oref0's UAM:
// the unexplained rise or fall decaying away). Pure; every learned one is fitted only on days before the one it
// predicts. Measured only: nothing here reaches a screen until the lab judges it materially better.
import { physEffect, type Predictor, type RContext } from './research';
import { rateBetween } from './trend';

const MIN = 60000, DAY = 86400000, KW = 3 * 3600000;
const dayOf = (t: number) => Math.floor((t + KW) / DAY) * DAY - KW;

/** Nearest reading to x within 3 min, on the minute series a predictor receives. */
function nearAt(t: number[], v: number[], x: number): number | null {
  let lo = 0, hi = t.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
  let b = -1;
  for (const k of [lo - 1, lo]) if (k >= 0 && k < t.length && Math.abs(t[k] - x) <= 3 * MIN && (b < 0 || Math.abs(t[k] - x) < Math.abs(t[b] - x))) b = k;
  return b < 0 ? null : v[b];
}
/** The last 30 minutes every 5 minutes, oldest first, ending at the reading itself; null if any is missing. */
function shape(t: number[], v: number[], i: number): number[] | null {
  const out: number[] = [];
  for (let k = 6; k >= 1; k--) { const y = nearAt(t, v, t[i] - k * 5 * MIN); if (y === null) return null; out.push(y); }
  out.push(v[i]);
  return out;
}
const pred = (g: number, d15: number, d30: number) => ({ v15: g + d15, v30: g + d30, rate: d15 / 15 });

/* ----------------------------------------------------------- smoothing */

/** Holt's double exponential smoothing over the last hour (5-min steps): level and slope, carried forward. */
export function holt(alpha: number, beta: number): Predictor {
  return (i, t, v) => {
    const xs: number[] = [];
    for (let k = 12; k >= 0; k--) { const y = k === 0 ? v[i] : nearAt(t, v, t[i] - k * 5 * MIN); if (y !== null) xs.push(y); }
    if (xs.length < 5) return null;
    let s = xs[0], b = xs[1] - xs[0];
    for (let k = 1; k < xs.length; k++) { const s0 = s; s = alpha * xs[k] + (1 - alpha) * (s + b); b = beta * (s - s0) + (1 - beta) * b; }
    return pred(v[i], s + 3 * b - v[i], s + 6 * b - v[i]);
  };
}

/** A constant-speed Kalman filter over the last hour of minute readings (state: glucose and its speed). `q`: how
 *  freely the speed may change; sensor noise fixed at 5 mg/dL. */
export function kalman(q: number): Predictor {
  const R = 25;
  return (i, t, v) => {
    let j = i; while (j > 0 && t[i] - t[j - 1] <= 60 * MIN) j--;
    if (i - j < 8) return null;
    let g = v[j], s = 0, P = [[R, 0], [0, 1]];
    for (let k = j + 1; k <= i; k++) {
      const dt = (t[k] - t[k - 1]) / MIN;
      g += s * dt;
      const p00 = P[0][0] + dt * (P[0][1] + P[1][0]) + dt * dt * P[1][1] + q * dt ** 3 / 3, p01 = P[0][1] + dt * P[1][1] + q * dt * dt / 2, p11 = P[1][1] + q * dt;
      const S = p00 + R, k0 = p00 / S, k1 = p01 / S, y = v[k] - g;
      g += k0 * y; s += k1 * y;
      P = [[(1 - k0) * p00, (1 - k0) * p01], [p01 - k1 * p00, p11 - k1 * p01]];
    }
    return pred(v[i], g + 15 * s - v[i], g + 30 * s - v[i]);
  };
}

/* ------------------------------------------------- the closed loops' ways */

/** Loop: the 15-min trend fading out over 15 minutes, then carbs and insulin (doctor's ratios), plus a retrospective
 *  correction: what the last 30 minutes did that carbs and insulin did not explain, fading out over an hour. */
export const loopStyle: Predictor = (i, t, v, _a, ctx) => {
  const now = t[i], r = rateBetween(t, v, now - 15 * MIN, now);
  const back = nearAt(t, v, now - 30 * MIN);
  if (r === null || back === null) return null;
  const rc = (v[i] - back - physEffect(ctx, now - 30 * MIN, now)) / 30;  // per minute
  const at = (h: number) => {
    let d = 0;
    for (let k = 0; k < h; k++) {
      const w = Math.max(0, 1 - k / 15), eff = physEffect(ctx, now + k * MIN, now + (k + 1) * MIN) + rc * Math.max(0, 1 - k / 60);
      d += w * r + (1 - w) * eff;
    }
    return d;
  };
  return pred(v[i], at(15), at(30));
};

/** oref0's unannounced-meal line: insulin's effect, plus the current deviation from it (whatever the reason: food not
 *  logged, adrenaline, a late fat bump) fading linearly to nothing over `fade` minutes. Logged carbs are ignored. */
export function uam(fade: number): Predictor {
  return (i, t, v, _a, ctx) => {
    const now = t[i], r = rateBetween(t, v, now - 15 * MIN, now);
    if (r === null) return null;
    const ins = { ...ctx, carbs: [] };
    const dev = r - physEffect(ins, now - 5 * MIN, now) / 5;
    const area = (h: number) => (h >= fade ? fade / 2 : h - (h * h) / (2 * fade));
    return pred(v[i], physEffect(ins, now, now + 15 * MIN) + dev * area(15), physEffect(ins, now, now + 30 * MIN) + dev * area(30));
  };
}

/* ------------------------------------------------- learned from her days */

interface Row { x: number[]; d15: number; d30: number; s: number[] }

/** Ridge regression with an intercept: weights for each target. */
function ridge(rows: Row[], lambda: number): { w15: number[]; w30: number[] } | null {
  if (rows.length < 200) return null;
  const p = rows[0].x.length + 1;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b15 = new Array(p).fill(0), b30 = new Array(p).fill(0);
  for (const r of rows) {
    const x = [1, ...r.x];
    for (let a = 0; a < p; a++) { b15[a] += x[a] * r.d15; b30[a] += x[a] * r.d30; for (let c = 0; c < p; c++) A[a][c] += x[a] * x[c]; }
  }
  for (let a = 1; a < p; a++) A[a][a] += lambda * rows.length;
  const solve = (b: number[]) => {
    const M = A.map((row, k) => [...row, b[k]]);
    for (let c = 0; c < p; c++) {
      let piv = c; for (let k = c + 1; k < p; k++) if (Math.abs(M[k][c]) > Math.abs(M[piv][c])) piv = k;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-9) return null;
      for (let k = 0; k < p; k++) if (k !== c) { const f = M[k][c] / M[c][c]; for (let j = c; j <= p; j++) M[k][j] -= f * M[c][j]; }
    }
    return M.map((row, k) => row[p] / M[k][k]);
  };
  const w15 = solve(b15), w30 = solve(b30);
  return w15 && w30 ? { w15, w30 } : null;
}
const dot = (w: number[], x: number[]) => w[0] + x.reduce((s, xi, k) => s + w[k + 1] * xi, 0);

/**
 * A model fitted each day on the days before it only (at least two), from moments every 5 minutes whose outcome
 * 30 minutes later was already known before the day began. `features` turns a moment into numbers.
 */
function dailyFit<M>(full: RContext, features: (t: number[], v: number[], i: number, ctx: RContext) => number[] | null, fit: (rows: Row[]) => M | null, use: (m: M, x: number[], s: number[] | null) => { d15: number; d30: number } | null): Predictor {
  const doses = [...full.doses].sort((a, b) => a.t - b.t), carbs = [...full.carbs].sort((a, b) => a.t - b.t);
  const ctxAt = (now: number): RContext => ({ ...full, doses: doses.filter((d) => d.t <= now && d.t > now - 8 * 3600000), carbs: carbs.filter((c) => c.t <= now && c.t > now - 8 * 3600000) });
  const cache = new WeakMap<number[], Map<number, M | null>>();
  return (i, t, v, _a, ctx) => {
    const day = dayOf(t[i]);
    let byDay = cache.get(t);
    if (!byDay) { byDay = new Map(); cache.set(t, byDay); }
    if (!byDay.has(day)) {
      let m: M | null = null;
      if (t.length && day - t[0] >= 2 * DAY) {
        const rows: Row[] = [];
        let last = -Infinity;
        for (let k = 0; k < t.length && t[k] + 30 * MIN < day; k++) {
          if (t[k] < day - 14 * DAY || t[k] - last < 5 * MIN) continue;
          const f15 = nearAt(t, v, t[k] + 15 * MIN), f30 = nearAt(t, v, t[k] + 30 * MIN);
          if (f15 === null || f30 === null) continue;
          const x = features(t, v, k, ctxAt(t[k])), s = shape(t, v, k);
          if (!x || !s) continue;
          last = t[k];
          rows.push({ x, d15: f15 - v[k], d30: f30 - v[k], s });
        }
        m = fit(rows);
      }
      byDay.set(day, m);
    }
    const m = byDay.get(day);
    if (!m) return null;
    const x = features(t, v, i, ctx);
    if (!x) return null;
    const d = use(m, x, shape(t, v, i));
    return d ? pred(v[i], d.d15, d.d30) : null;
  };
}

/** The last six 5-minute changes. */
const lags = (t: number[], v: number[], i: number) => { const s = shape(t, v, i); return s ? s.slice(1).map((y, k) => y - s[k]) : null; };

/** AR: the next 15 and 30 minutes from the last six 5-minute changes, weights learned from her earlier days. */
export const arModel = (full: RContext): Predictor =>
  dailyFit(full, (t, v, i) => lags(t, v, i), (rows) => ridge(rows, 0.01), (m, x) => ({ d15: dot(m.w15, x), d30: dot(m.w30, x) }));

/** ARX: AR plus what logged insulin and carbs will do over the next 15 and 30 minutes (doctor's ratios) and the
 *  starting level, so it learns how much to trust them. */
export const arxModel = (full: RContext): Predictor =>
  dailyFit(full, (t, v, i, ctx) => {
    const l = lags(t, v, i);
    if (!l) return null;
    const ins = { ...ctx, carbs: [] }, food = { ...ctx, doses: [] }, now = t[i];
    return [...l, physEffect(ins, now, now + 15 * MIN), physEffect(ins, now, now + 30 * MIN), physEffect(food, now, now + 15 * MIN), physEffect(food, now, now + 30 * MIN), v[i] - 120];
  }, (rows) => ridge(rows, 0.01), (m, x) => ({ d15: dot(m.w15, x), d30: dot(m.w30, x) }));

/** Nearest shapes: the `k` moments of her earlier days whose last 30 minutes looked most like now (same level
 *  roughly, same moves), and the median of what came next. */
export const analogModel = (full: RContext, k = 15): Predictor =>
  dailyFit(full, (t, v, i) => [v[i]], (rows) => (rows.length >= 200 ? rows : null), (rows, _x, s) => {
    if (!s) return null;
    const rel = s.map((y) => y - s[6]);
    const best: { r: Row; d: number }[] = [];   // the k nearest, kept sorted (no full sort per moment)
    for (const r of rows) {
      let d = ((r.s[6] - s[6]) / 3) ** 2;
      for (let j = 0; j < 6 && (best.length < k || d < best[best.length - 1].d); j++) d += (r.s[j] - r.s[6] - rel[j]) ** 2;
      if (best.length === k && d >= best[k - 1].d) continue;
      let at = best.length; while (at > 0 && best[at - 1].d > d) at--;
      best.splice(at, 0, { r, d }); if (best.length > k) best.pop();
    }
    const med = (xs: number[]) => { const o = [...xs].sort((a, b) => a - b); return o[o.length >> 1]; };
    return { d15: med(best.map((b) => b.r.d15)), d30: med(best.map((b) => b.r.d30)) };
  });
