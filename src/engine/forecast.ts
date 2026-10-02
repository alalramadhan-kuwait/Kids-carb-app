// Forecast lines for the glucose graph. Pure, tested in Node. Display only: production calculations (the trend
// arrow's 30-minute projection, the on-board estimate, the predictions frozen at each meal); no research model,
// and nothing here feeds the dose calculator.
import { cobAt, iobAt, type CarbEntry, type Dose, type IobParams } from './iob';
import type { Ratio } from './status';

const MIN = 60000;
export interface Pt { t: number; v: number }
export interface Forecast { kind: 'trend' | 'onboard' | 'past'; pts: Pt[]; key: string }

/** The trend arrow's projection: a straight line from the newest reading to where the same rate leads in 30 min. */
export function trendForecast(last: Pt | null, projected30: number | null, now: number): Forecast | null {
  if (!last || projected30 === null || now - last.t > 15 * MIN) return null;
  return { kind: 'trend', key: 'trend', pts: [last, { t: last.t + 30 * MIN, v: projected30 }] };
}

/**
 * Where glucose heads as what was logged is used up: start + carbs absorbed ÷ CR × ISF − insulin used × ISF, every
 * 5 minutes until nothing is left (at most 6 h). Same arithmetic as the on-board estimate on Status.
 */
export function onboardForecast(last: Pt | null, now: number, doses: Dose[], carbs: CarbEntry[], iob: IobParams | null, absorb: number | null, ratio: Ratio | null): Forecast | null {
  if (!last || !iob || !absorb || !ratio || now - last.t > 15 * MIN) return null;
  const t0 = last.t, I0 = iobAt(t0, doses, iob), C0 = cobAt(t0, carbs, absorb);
  if (I0 < 0.05 && C0 < 1) return null; // nothing on board: no curve
  let end = t0;
  for (const d of doses) if (d.t <= t0 && t0 - d.t < iob.dia * MIN) end = Math.max(end, d.t + iob.dia * MIN);
  for (const c of carbs) if (c.t <= t0 && t0 - c.t < absorb * MIN) end = Math.max(end, c.t + absorb * MIN);
  end = Math.min(end, t0 + 6 * 60 * MIN);
  const pts: Pt[] = [];
  for (let t = t0; t <= end; t += 5 * MIN) {
    const v = last.v + ((C0 - cobAt(t, carbs, absorb)) / ratio.cr) * ratio.isf - (I0 - iobAt(t, doses, iob)) * ratio.isf;
    pts.push({ t, v: Math.max(20, Math.min(450, v)) });
  }
  return pts.length > 1 ? { kind: 'onboard', key: 'onboard', pts } : null;
}

/** The curve frozen at the latest meal or dose that starts inside the view (one line, so the graph stays readable). */
export function pastForecasts(rows: { key: string; t0: string; curve: number[] }[], start: number, end: number): Forecast[] {
  let best: { key: string; t0: number; curve: number[] } | null = null;
  for (const r of rows) {
    const t0 = Date.parse(r.t0);
    if (!r.curve?.length || t0 < start || t0 > end) continue;
    if (!best || t0 > best.t0) best = { key: r.key, t0, curve: r.curve };
  }
  return best ? [{ kind: 'past', key: 'p' + best.key, pts: best.curve.map((v, k) => ({ t: best!.t0 + k * 15 * MIN, v })) }] : [];
}
