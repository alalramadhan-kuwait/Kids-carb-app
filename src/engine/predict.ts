// Prediction tracking. Pure, tested in Node. At the start of each meal (or a correction on its own) the app freezes
// a predicted glucose curve from the doctor's ratios and the insulin and carb models, then compares it with the
// sensor at 1 hour, 2 hours and the end. Only meals with nothing else logged in between count toward accuracy.
import { iobFraction, type IobParams } from './iob';
import { ratioAt } from './status';
import type { Ratio } from './status';
import type { EventRow, HistoryEntry } from '../lib/types';

const MIN = 60000, STEP = 15 * MIN;
const KW = 3 * 3600000;
export const PLAN_AFTER = 15 * MIN;      // entries up to 15 min after the start belong to the same plan
const NEAR = 10 * MIN;                   // a reading this close to a moment stands for it

export interface Entry { key: string; t: number; kind: 'meal' | 'carbs' | 'dose' | 'treatment' | 'exercise'; grams: number; units: number; name: string | null; recipe_id: string | null; unknown?: boolean }

/** Everything that can start or disturb a prediction, oldest first. */
export function entriesFrom(history: HistoryEntry[], events: EventRow[]): Entry[] {
  const out: Entry[] = [];
  for (const h of history) out.push({ key: 'h:' + h.id, t: Date.parse(h.eaten_at), kind: 'meal', grams: h.total_carbs ?? 0, unknown: h.total_carbs === null, units: 0, name: h.name, recipe_id: h.recipe_id });
  for (const e of events) {
    if (e.deleted_at) continue;
    const t = Date.parse(e.occurred_at), base = { key: 'e:' + e.id, t, grams: 0, units: 0, name: null, recipe_id: null };
    if (e.kind === 'carbs' && e.carbs_g) out.push({ ...base, kind: 'carbs', grams: e.carbs_g });
    else if (e.kind === 'treatment') out.push({ ...base, kind: 'treatment', grams: e.carbs_g ?? 0 });
    else if (e.kind === 'insulin' && e.insulin_type !== 'long' && e.insulin_units) out.push({ ...base, kind: 'dose', units: e.insulin_units });
    else if (e.kind === 'exercise') out.push({ ...base, kind: 'exercise' });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A meal (5 g or more) or a dose starts a prediction unless something was logged in the 15 minutes before it. */
export function triggers(entries: Entry[]): Entry[] {
  return entries.filter((e, i) => {
    if (!((e.kind === 'meal' || e.kind === 'carbs') && e.grams >= 5) && e.kind !== 'dose') return false;
    for (let j = i - 1; j >= 0 && e.t - entries[j].t < PLAN_AFTER; j--) if (entries[j].kind !== 'exercise') return false;
    return true;
  });
}

export interface Model { iob: IobParams; absorb: number; ratios: Ratio[] }
export interface Prediction {
  key: string; t0: number; name: string | null; recipe_id: string | null;
  carbs: number; units: number; start_mg: number;
  params: { cr: number; isf: number; dia: number; peak: number; absorb: number; onboard_iob: number; onboard_cob: number };
  curve: number[]; end_min: number;
}

const remIns = (dt: number, p: IobParams) => (dt < 0 ? 1 : iobFraction(dt / MIN, p));
const remCarb = (dt: number, absorb: number) => (dt < 0 ? 1 : Math.max(0, 1 - dt / (absorb * MIN)));

/** The frozen curve: start + carbs absorbed × ISF ÷ CR − insulin used × ISF, every 15 minutes until all is used up. */
export function predict(trigger: Entry, entries: Entry[], startMg: number, m: Model): Prediction | null {
  const t0 = trigger.t;
  const ratio = ratioAt(m.ratios, Math.floor(((t0 + KW) % 86400000) / MIN));
  if (!ratio) return null;
  const inPlan = (e: Entry, life: number) => e.t <= t0 + PLAN_AFTER && t0 - e.t < life * MIN;
  // food whose carbs are not known: no curve can be drawn through it
  if (entries.some((e) => e.unknown && inPlan(e, m.absorb))) return null;
  const doses = entries.filter((e) => e.kind === 'dose' && inPlan(e, m.iob.dia));
  const carbs = entries.filter((e) => (e.kind === 'meal' || e.kind === 'carbs' || e.kind === 'treatment') && e.grams > 0 && inPlan(e, m.absorb));
  const I = (t: number) => doses.reduce((s, d) => s + d.units * remIns(t - d.t, m.iob), 0);
  const C = (t: number) => carbs.reduce((s, c) => s + c.grams * remCarb(t - c.t, m.absorb), 0);
  let end = t0;
  for (const d of doses) end = Math.max(end, d.t + m.iob.dia * MIN);
  for (const c of carbs) end = Math.max(end, c.t + m.absorb * MIN);
  const end_min = Math.min(360, Math.max(120, Math.ceil((end - t0) / STEP) * 15));
  const I0 = I(t0), C0 = C(t0), curve: number[] = [];
  for (let k = 0; k * 15 <= end_min; k++) {
    const t = t0 + k * STEP;
    curve.push(Math.round(startMg + ((C0 - C(t)) / ratio.cr) * ratio.isf - (I0 - I(t)) * ratio.isf));
  }
  const after = (e: Entry) => e.t > t0;
  return {
    key: trigger.key, t0, name: trigger.name, recipe_id: trigger.recipe_id,
    carbs: carbs.filter((c) => c.t >= t0).reduce((s, c) => s + c.grams, 0), units: doses.filter((d) => d.t >= t0).reduce((s, d) => s + d.units, 0), start_mg: startMg,
    params: { cr: ratio.cr, isf: ratio.isf, dia: m.iob.dia, peak: m.iob.peak, absorb: m.absorb,
      onboard_iob: Math.round(doses.filter((d) => !after(d) && d.t < t0).reduce((s, d) => s + d.units * remIns(t0 - d.t, m.iob), 0) * 100) / 100,
      onboard_cob: Math.round(carbs.filter((c) => c.t < t0).reduce((s, c) => s + c.grams * remCarb(t0 - c.t, m.absorb), 0)) },
    curve, end_min,
  };
}

export type CheckKey = '60' | '120' | 'end';
export type Check = { pred: number; actual: number } | { skip: 'other_entry' | 'no_data' };
export const checkMinutes = (end_min: number): [CheckKey, number][] =>
  ([['60', 60], ['120', 120], ['end', end_min]] as [CheckKey, number][]).filter(([k, m]) => m <= end_min && !(k === 'end' && end_min <= 120));

/** The predicted value at a minute from the start (between two 15-minute points, in a straight line). */
export function predAt(curve: number[], min: number) {
  const k = Math.min(curve.length - 1, Math.floor(min / 15)), f = min / 15 - k;
  return k + 1 < curve.length ? curve[k] + (curve[k + 1] - curve[k]) * f : curve[k];
}

/** The reading nearest a moment, within 10 minutes. Series in ms and mg/dL, sorted. */
export function readingNear(t: number[], v: number[], at: number): number | null {
  let best = -1, dist = Infinity;
  for (let i = 0; i < t.length; i++) { const d = Math.abs(t[i] - at); if (d < dist) { dist = d; best = i; } }
  return best >= 0 && dist <= NEAR ? v[best] : null;
}

/** Fill whatever checkpoints have passed. A checkpoint after anything else was logged is skipped, not guessed. */
export function fillChecks(p: { key: string; t0: number; curve: number[]; end_min: number; checks: Partial<Record<CheckKey, Check>> },
  entries: Entry[], t: number[], v: number[], now: number): { checks: Partial<Record<CheckKey, Check>>; done: boolean } {
  const checks = { ...p.checks };
  const disturb = entries.find((e) => e.key !== p.key && e.t > p.t0 + PLAN_AFTER && e.t <= p.t0 + p.end_min * MIN)?.t ?? Infinity;
  let done = true;
  for (const [k, m] of checkMinutes(p.end_min)) {
    if (checks[k]) continue;
    const at = p.t0 + m * MIN;
    if (at >= disturb) { checks[k] = { skip: 'other_entry' }; continue; }
    if (now < at + NEAR) { done = false; continue; }
    const actual = readingNear(t, v, at);
    checks[k] = actual === null ? { skip: 'no_data' } : { pred: Math.round(predAt(p.curve, m)), actual };
  }
  return { checks, done };
}

export interface Accuracy { key: CheckKey; n: number; mae: number; bias: number; within: number } // mg/dL; bias > 0: higher than predicted
/** Average miss and direction at each checkpoint, from predictions that count (not excluded, value present). */
export function accuracy(rows: { checks: Partial<Record<CheckKey, Check>>; excluded: string | null }[]): Accuracy[] {
  return (['60', '120', 'end'] as CheckKey[]).map((key) => {
    const errs: number[] = [];
    for (const r of rows) { const c = r.checks[key]; if (!r.excluded && c && 'actual' in c) errs.push(c.actual - c.pred); }
    const n = errs.length;
    return { key, n, mae: n ? errs.reduce((s, e) => s + Math.abs(e), 0) / n : 0, bias: n ? errs.reduce((s, e) => s + e, 0) / n : 0,
      within: n ? errs.filter((e) => Math.abs(e) <= 18).length / n : 0 };
  });
}
