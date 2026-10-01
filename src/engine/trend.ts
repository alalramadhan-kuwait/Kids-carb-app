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

export function trendFrom(readings: Reading[], now: number): Trend | null {
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
