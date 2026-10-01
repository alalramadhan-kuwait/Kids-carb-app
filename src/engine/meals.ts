// Meal response per recipe (GLUCOSE_PLAN 10.7, 11.10). Pure: clean-meal rules, curves aligned at T0 = meal
// time, and medians — a single strange day never dominates.
import type { EventRow, HistoryEntry } from '../lib/types';
import { mealResponse, type MealResponse } from './events';
import { GAP_MS, emptySeries, mergeSeries, nearest, type Series } from './series';

const MIN = 60000;
export const GRID = Array.from({ length: 61 }, (_, k) => -60 + k * 5); // −60 … +240 min, every 5 min
export const MIN_CLEAN = 3;

/** Readings from glucose_windows (minutes from t0) as a series in absolute time. */
export const windowSeries = (t0: number, o: number[], v: number[]): Series => mergeSeries(emptySeries(), o.map((m) => t0 + m * MIN), v);

/** Share of 0–240 min covered by readings (each counts until the next, up to 15 min, never across a gap). */
export function coverage(s: Series, t0: number, minutes = 240) {
  let covered = 0;
  const end = t0 + minutes * MIN;
  for (let i = 0; i < s.t.length; i++) {
    const a = Math.max(s.t[i], t0), next = i + 1 < s.t.length ? s.t[i + 1] : end;
    if (s.t[i] > end || next < t0) continue;
    const b = Math.min(end, next - s.t[i] > GAP_MS ? s.t[i] + 15 * MIN : Math.min(next, s.t[i] + 15 * MIN));
    if (b > a) covered += b - a;
  }
  return covered / (minutes * MIN);
}

/** Why a meal is not "clean" (empty = clean): anything else that moves glucose in the 4 hours after it. */
export function notClean(meal: HistoryEntry, history: HistoryEntry[], events: EventRow[], s: Series): string[] {
  const t0 = Date.parse(meal.eaten_at), end = t0 + 240 * MIN;
  const within = (iso: string, from = t0 + 1, to = end) => { const t = Date.parse(iso); return t >= from && t <= to; };
  const why: string[] = [];
  if (history.some((h) => h.id !== meal.id && within(h.eaten_at))) why.push('أكل آخر خلال 4 ساعات');
  for (const e of events) {
    if (e.deleted_at) continue;
    if (e.kind === 'carbs' && within(e.occurred_at)) why.push('كارب إضافي');
    if (e.kind === 'treatment' && within(e.occurred_at)) why.push('علاج انخفاض');
    if (e.kind === 'exercise' && within(e.occurred_at, t0 - 60 * MIN)) why.push('رياضة');
    if (e.kind === 'insulin' && e.insulin_type !== 'long' && e.bolus_purpose === 'correction' && within(e.occurred_at)) why.push('جرعة تصحيح');
  }
  if (coverage(s, t0) < 0.9) why.push('قراءات ناقصة');
  return [...new Set(why)];
}

export interface Occurrence { meal: HistoryEntry; t0: number; series: Series; response: MealResponse; reasons: string[]; curve: (number | null)[] }

/** Glucose at each grid offset: the nearest reading within ±5 min, never across a gap. */
export function alignCurve(s: Series, t0: number): (number | null)[] {
  return GRID.map((o) => { const i = nearest(s, t0 + o * MIN, 5 * MIN); return i === null ? null : s.v[i]; });
}

export function buildOccurrence(meal: HistoryEntry, s: Series, history: HistoryEntry[], events: EventRow[], now = Date.now()): Occurrence {
  const t0 = Date.parse(meal.eaten_at);
  return { meal, t0, series: s, response: mealResponse(s, t0, events, now), reasons: notClean(meal, history, events, s), curve: alignCurve(s, t0) };
}

const quantile = (sorted: number[], p: number) => {
  if (!sorted.length) return null;
  const k = (sorted.length - 1) * p, f = Math.floor(k), c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
};
export const median = (xs: (number | null | undefined)[]) => quantile(xs.filter((x): x is number => x != null).sort((a, b) => a - b), 0.5);

/** Median curve with its 25–75 % band, only where at least MIN_CLEAN curves have a value. */
export function medianCurve(curves: (number | null)[][]) {
  return GRID.map((_, k) => {
    const vals = curves.map((c) => c[k]).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return vals.length >= MIN_CLEAN ? { p25: quantile(vals, 0.25)!, p50: quantile(vals, 0.5)!, p75: quantile(vals, 0.75)! } : null;
  });
}

/** The recipe summary from clean meals only (medians). */
export function summary(clean: Occurrence[]) {
  return {
    n: clean.length,
    carbs: median(clean.map((o) => o.meal.total_carbs)),
    insulin: median(clean.map((o) => o.response.bolus?.insulin_units ?? null)),
    g0: median(clean.map((o) => o.response.g0)),
    peak: median(clean.map((o) => o.response.peak)),
    rise: median(clean.map((o) => o.response.rise)),
    ttp: median(clean.map((o) => o.response.ttp)),
    at180: median(clean.map((o) => o.response.at[180])),
  };
}
