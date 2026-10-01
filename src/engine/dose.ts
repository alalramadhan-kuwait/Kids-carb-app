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
  glucose: { mg: number; at: number; trend: number | null } | null;
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
  if (g.trend === 1) return none('falling');

  const food = Math.max(0, p.carbs) / p.ratio.cr;
  // above the range: down to its top; below it: lower the dose up to its bottom; inside it: nothing
  let correction = g.mg > p.target.high ? (g.mg - p.target.high) / p.ratio.isf : g.mg < p.target.low ? (g.mg - p.target.low) / p.ratio.isf : 0;
  let iobUsed = 0;
  if (correction > 0) { iobUsed = Math.min(correction, Math.max(0, p.iob)); correction -= iobUsed; } // insulin still working covers the correction first
  const raw = Math.max(0, food + correction);
  const dose = Math.floor(raw / p.step + 1e-9) * p.step; // always down to the pen's step
  return { block: null, food, correction, iobUsed, raw, dose };
}
