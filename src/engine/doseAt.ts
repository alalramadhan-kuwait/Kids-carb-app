// What the doctor's plan would have said at an earlier moment: the same calculator (engine/dose.ts) fed with the
// reading, the arrow, the insulin still working and the doctor's block at that time, instead of now. Used when food
// is logged after it was eaten, so the parents can see whether their choice then matched the plan. Information only:
// nothing is given or changed by it. Pure, tested in Node.
import { suggestDose, type DoseResult } from './dose';
import { iobAt, iobParamsOk, type Dose } from './iob';
import { ratioAt, type Ratio } from './status';
import { levelOf, rateBetween } from './trend';

const MIN = 60000, KW = 3 * 3600000;

export interface DoseAtInput {
  at: number; carbs: number;
  t: ArrayLike<number>; v: ArrayLike<number>;          // readings (ms, mg/dL), sorted
  doses: Dose[];                                        // rapid doses
  ratios: Ratio[]; target: { low: number; high: number } | null;
  lowMg: number | null; dia: number | null; peak: number | null; gapMin: number; step: number;
  sensorStartedAt: number | null;
}
export interface DoseAt { r: DoseResult; glucose: number | null; iob: number | null }

export function doseAt(p: DoseAtInput): DoseAt {
  // the last reading at or before that moment (never one taken after it)
  let i = -1;
  for (let k = 0; k < p.t.length; k++) { if (p.t[k] <= p.at + MIN) i = k; else break; }
  const tt = Array.from(p.t), vv = Array.from(p.v);
  const rate = i < 0 ? null : rateBetween(tt.slice(0, i + 1), vv.slice(0, i + 1), p.t[i] - 15 * MIN, p.t[i]);
  const iobP = p.dia && p.peak ? { dia: p.dia, peak: p.peak } : null;
  const before = p.doses.filter((d) => d.t <= p.at);
  const iob = iobParamsOk(iobP) ? iobAt(p.at, before, iobP) : null;
  const lastRapidAt = before.reduce<number | null>((m, d) => (m === null || d.t > m ? d.t : m), null);
  const r = suggestDose({
    now: p.at, carbs: p.carbs, ratio: ratioAt(p.ratios, Math.floor(((p.at + KW) % 86400000) / MIN)), target: p.target, lowMg: p.lowMg,
    glucose: i < 0 ? null : { mg: p.v[i], at: p.t[i], level: rate === null ? null : levelOf(rate) },
    sensorStartedAt: p.sensorStartedAt, iob, lastRapidAt, gapMin: p.gapMin, step: p.step,
  });
  return { r, glucose: i < 0 ? null : p.v[i], iob };
}
