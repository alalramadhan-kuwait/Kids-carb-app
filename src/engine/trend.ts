// Our own trend from her readings (the arrow Abbott sends covers only the newest reading and has 5 steps).
// Pure, tested in Node. Rate = least-squares slope over the last 15–20 minutes of readings with no gap, so a
// single noisy reading does not flip it. Seven steps: Dexcom's double arrows for very fast change included.
import type { Reading } from '../lib/glucose';

const MIN = 60000;

export type Level = -3 | -2 | -1 | 0 | 1 | 2 | 3;
export interface Trend {
  rate: number;              // mg/dL per minute
  change15: number;          // mg/dL over 15 minutes at that rate
  level: Level;              // ⇊ ↓ ↘ → ↗ ↑ ⇈
  projected30: number | null; // where the same rate leads in 30 minutes (only from a solid fit)
  at: number;                // time of the newest reading used
}

/** Steps in mg/dL per minute: under 1 steady; 1–2 slowly; 2–3 fast; over 3 very fast (≈0.17 mmol/L a minute). */
export function levelOf(rate: number): Level {
  const a = Math.abs(rate), s = rate < 0 ? -1 : 1;
  return (a < 1 ? 0 : a < 2 ? s : a < 3 ? 2 * s : 3 * s) as Level;
}

/** Abbott's arrow (1 ↓ … 5 ↑) on the same scale, for comparison and as a fallback. */
export const levelFromLibre = (arrow: number | null): Level | null =>
  arrow === 1 ? -2 : arrow === 2 ? -1 : arrow === 3 ? 0 : arrow === 4 ? 1 : arrow === 5 ? 2 : null;

/** Our step mapped back to Abbott's 1–5 (double arrows count as fast), for wording shared with older screens. */
export const libreOf = (l: Level): number => (l <= -2 ? 1 : l === -1 ? 2 : l === 0 ? 3 : l === 1 ? 4 : 5);

/**
 * LibreLinkUp sends two kinds of reading: one a minute (with Abbott's arrow) and a 15-minute history point
 * (no arrow) that is processed differently and sits a few mg/dL off its neighbours. Where minute readings exist,
 * the history point beside them (within 2 minutes) is left out of any rate.
 */
export function minuteOnly<T>(t: number[], arrow: (number | null)[], rows: T[]): T[] {
  const marked = t.filter((_, i) => arrow[i] !== null);
  let j = 0;
  return rows.filter((_, i) => {
    if (arrow[i] !== null) return true;
    while (j < marked.length && marked[j] < t[i] - 2 * MIN) j++;
    return !(j < marked.length && marked[j] <= t[i] + 2 * MIN);
  });
}

export function trendFrom(all: Reading[], now: number): Trend | null {
  const times = all.map((r) => Date.parse(r.taken_at));
  const readings = minuteOnly(times, all.map((r) => r.trend), all);
  if (!readings.length) return null;
  const pts: [number, number][] = [];
  for (let i = readings.length - 1; i >= 0; i--) pts.push([Date.parse(readings[i].taken_at), readings[i].mg_dl]);
  pts.sort((a, b) => b[0] - a[0]);
  const last = pts[0][0];
  if (now - last > 15 * MIN) return null;                       // too old to say where it is heading
  const use: [number, number][] = [];
  for (const p of pts) {
    if (last - p[0] > 20 * MIN) break;
    if (use.length && use[use.length - 1][0] - p[0] > 16 * MIN) break; // never across a gap
    use.push(p);
  }
  const span = use.length ? (last - use[use.length - 1][0]) / MIN : 0;
  if (use.length < 2 || span < 5) return null;
  const mt = use.reduce((s, p) => s + p[0], 0) / use.length, mv = use.reduce((s, p) => s + p[1], 0) / use.length;
  let num = 0, den = 0;
  for (const [t, v] of use) { const dt = (t - mt) / MIN; num += dt * (v - mv); den += dt * dt; }
  if (!den) return null;
  const rate = num / den;
  const solid = use.length >= 3 && span >= 10;
  const end = mv + rate * ((last - mt) / MIN);                   // the fitted value now, steadier than the last point
  return {
    rate, change15: rate * 15, level: levelOf(rate), at: last,
    projected30: solid ? Math.max(40, Math.min(400, end + rate * 30)) : null,
  };
}

// ── which arrow is more accurate: Libre's or ours ────────────────────────────────────────────────
// Each arrow is a claim about the next 15 minutes. For readings that carried Libre's arrow (sampled every
// 5 minutes so one long steady spell does not dominate), both arrows are compared on Libre's 5 steps with what
// the readings then did: the fitted rate over the following 15 minutes.

/** Least-squares rate (mg/dL per minute) over readings in [from, to], walking back from the newest, never across a gap. */
export function rateBetween(t: number[], v: number[], from: number, to: number, minPts = 2, minSpan = 5): number | null {
  let a = 0, b = t.length - 1, hi = -1; // last reading at or before `to` (binary search: weeks of readings)
  while (a <= b) { const m = (a + b) >> 1; if (t[m] <= to) { hi = m; a = m + 1; } else b = m - 1; }
  if (hi < 0 || t[hi] < from) return null;
  let lo = hi;
  while (lo > 0 && t[lo - 1] >= from && t[lo] - t[lo - 1] <= 16 * MIN) lo--;
  const n = hi - lo + 1;
  if (n < minPts || (t[hi] - t[lo]) / MIN < minSpan) return null;
  let mt = 0, mv = 0;
  for (let k = lo; k <= hi; k++) { mt += t[k]; mv += v[k]; }
  mt /= n; mv /= n;
  let num = 0, den = 0;
  for (let k = lo; k <= hi; k++) { const dt = (t[k] - mt) / MIN; num += dt * (v[k] - mv); den += dt * dt; }
  return den ? num / den : null;
}

const five = (l: Level) => Math.max(-2, Math.min(2, l));
export interface ArrowScore { exact: number; within1: number; fastCaught: number | null } // shares 0–1
export interface ArrowComparison { n: number; fastN: number; ours: ArrowScore; libre: ArrowScore }

export function compareArrows(t0: number[], v0: number[], a0: (number | null)[], now: number): ArrowComparison {
  const idx = minuteOnly(t0, a0, t0.map((_, i) => i));
  const t = idx.map((i) => t0[i]), v = idx.map((i) => v0[i]), a = idx.map((i) => a0[i]);
  const acc = { ours: { exact: 0, within1: 0, fast: 0 }, libre: { exact: 0, within1: 0, fast: 0 } };
  let n = 0, fastN = 0, last = -Infinity;
  for (let i = 0; i < t.length; i++) {
    const lib = levelFromLibre(a[i] ?? null);
    if (lib === null || t[i] > now - 15 * MIN || t[i] - last < 5 * MIN) continue;
    const before = rateBetween(t, v, t[i] - 20 * MIN, t[i]);
    const after = rateBetween(t, v, t[i], t[i] + 15 * MIN, 3, 10);
    if (before === null || after === null) continue;
    last = t[i]; n++;
    const truth = five(levelOf(after)), ours = five(levelOf(before));
    for (const [k, guess] of [['ours', ours], ['libre', lib]] as const) {
      if (guess === truth) acc[k].exact++;
      if (Math.abs(guess - truth) <= 1) acc[k].within1++;
      if (Math.abs(truth) === 2 && guess === truth) acc[k].fast++;
    }
    if (Math.abs(truth) === 2) fastN++;
  }
  const score = (s: { exact: number; within1: number; fast: number }): ArrowScore =>
    ({ exact: n ? s.exact / n : 0, within1: n ? s.within1 / n : 0, fastCaught: fastN ? s.fast / fastN : null });
  return { n, fastN, ours: score(acc.ours), libre: score(acc.libre) };
}

/** The verdict needs enough moments and a clear gap (5 points on exact matches), else "no clear winner yet". */
export const arrowWinner = (c: ArrowComparison): 'ours' | 'libre' | null =>
  c.n < 50 ? null : c.ours.exact - c.libre.exact >= 0.05 ? 'ours' : c.libre.exact - c.ours.exact >= 0.05 ? 'libre' : null;
