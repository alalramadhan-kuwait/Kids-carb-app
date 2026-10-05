// Dose calculator (the parents' decision, 2026-10-01). Pure, tested in Node. Standard bolus-calculator arithmetic
// with the doctor's numbers: food = carbs ÷ carb ratio; correction to the doctor's target range by the correction
// factor, reduced by the rapid insulin still working; rounded down to the pen's step. It refuses, with the reason,
// whenever the inputs cannot be trusted. The parent always confirms or changes the number before it is logged.
import type { Ratio } from './status';

const MIN = 60000;

export interface DoseInput {
  now: number;
  carbs: number;                                   // grams to cover, checked by the parent
  ratio: Ratio | null;                             // the doctor's block in effect now
  target: { low: number; high: number } | null;    // mg/dL; inside it there is no correction
  lowMg: number | null;                            // below this: no dose at all
  glucose: { mg: number; at: number; level: number | null } | null; // level: -3 … 3 from engine/trend
  sensorStartedAt: number | null;
  iob: number | null;                              // rapid units still working (null: no model)
  lastRapidAt: number | null;
  gapMin: number;                                  // no two rapid doses closer than this
  step: number;                                    // pen step, 1 or 0.5
}

export type DoseBlock = 'no_plan' | 'recent_dose' | 'no_reading' | 'warmup' | 'low' | 'falling';
export interface DoseResult {
  block: DoseBlock | null;
  until?: number;                                  // recent_dose: when the next one may be given
  food: number; correction: number; iobUsed: number;
  raw: number; dose: number;
}

export function suggestDose(p: DoseInput): DoseResult {
  const none = (block: DoseBlock, until?: number): DoseResult => ({ block, until, food: 0, correction: 0, iobUsed: 0, raw: 0, dose: 0 });
  if (!p.ratio || !p.target || p.iob === null) return none('no_plan');
  if (p.lastRapidAt !== null && p.now - p.lastRapidAt < p.gapMin * MIN) return none('recent_dose', p.lastRapidAt + p.gapMin * MIN);
  const g = p.glucose;
  if (!g || p.now - g.at > 15 * MIN) return none('no_reading');
  if (p.sensorStartedAt !== null && p.now - p.sensorStartedAt < 60 * MIN) return none('warmup');
  if (p.lowMg !== null && g.mg < p.lowMg) return none('low');
  if (g.level !== null && g.level <= -2) return none('falling'); // falling fast (2 mg/dL a minute or more)

  const food = Math.max(0, p.carbs) / p.ratio.cr;
  // above the range: down to its top; below it: lower the dose up to its bottom; inside it: nothing
  let correction = g.mg > p.target.high ? (g.mg - p.target.high) / p.ratio.isf : g.mg < p.target.low ? (g.mg - p.target.low) / p.ratio.isf : 0;
  let iobUsed = 0;
  if (correction > 0) { iobUsed = Math.min(correction, Math.max(0, p.iob)); correction -= iobUsed; } // insulin still working covers the correction first
  const raw = Math.max(0, food + correction);
  const dose = Math.floor(raw / p.step + 1e-9) * p.step; // always down to the pen's step
  return { block: null, food, correction, iobUsed, raw, dose };
}

export interface DoseGap { lastAt: number; lastUnits: number; until: number; left: number; frac: number }
/** The care plan's gap between rapid doses, for the Now screen: when the last rapid dose was and when the gap ends.
 *  Null when there is no rapid dose in the last 6 hours (or the gap is off). Says nothing about whether to dose. */
export function doseGap(doses: { t: number; units: number }[], now: number, gapMin: number): DoseGap | null {
  if (!(gapMin > 0)) return null;
  const last = doses.filter((d) => d.t <= now).reduce<{ t: number; units: number } | null>((m, d) => (!m || d.t > m.t ? d : m), null);
  if (!last || now - last.t > Math.max(6 * 60, gapMin) * MIN) return null;
  // doses a few minutes apart are one dose given in parts: the gap runs from the last of them, the units add up
  const units = doses.filter((d) => d.t <= now && last.t - d.t <= 15 * MIN).reduce((s, d) => s + d.units, 0);
  const until = last.t + gapMin * MIN;
  return { lastAt: last.t, lastUnits: units, until, left: Math.max(0, until - now), frac: Math.min(1, (now - last.t) / (gapMin * MIN)) };
}

/**
 * The calculation told back, step by step, from what was saved with a logged dose (its snapshot): food, the
 * correction before and after the insulin still working, the total and its rounding down to the pen step.
 * Rebuilt from the saved inputs with the same arithmetic as suggestDose; display only.
 */
export interface DoseSteps {
  carbs: number; cr: number; food: number;
  glucose: number; target: [number, number]; isf: number;
  side: 'above' | 'below' | 'inside'; correction: number; // before the insulin still working
  iob: number; iobUsed: number; raw: number; step: number; dose: number;
}
export function doseSteps(s: { carbs: number; cr: number; glucose: number; isf: number; target: [number, number]; iob: number; pen_step?: number | null }): DoseSteps {
  const food = Math.max(0, s.carbs) / s.cr;
  const side = s.glucose > s.target[1] ? 'above' : s.glucose < s.target[0] ? 'below' : 'inside';
  const correction = side === 'above' ? (s.glucose - s.target[1]) / s.isf : side === 'below' ? (s.glucose - s.target[0]) / s.isf : 0;
  const iobUsed = correction > 0 ? Math.min(correction, Math.max(0, s.iob)) : 0;
  const raw = Math.max(0, food + correction - iobUsed);
  const step = s.pen_step ?? 1;
  return { carbs: s.carbs, cr: s.cr, food, glucose: s.glucose, target: s.target, isf: s.isf, side, correction, iob: s.iob, iobUsed, raw, step, dose: Math.floor(raw / step + 1e-9) * step };
}
