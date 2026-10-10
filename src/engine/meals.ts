// Meal response per recipe (GLUCOSE_PLAN 10.7, 11.10). Pure: clean-meal rules, curves aligned at T0 = meal
// time, and medians — a single strange day never dominates.
import type { EventRow, HistoryEntry } from '../lib/types';
import { mealResponse, type MealResponse } from './events';
import { GAP_MS, emptySeries, mergeSeries, nearest, type Series } from './series';
import { t } from '../i18n';

const MIN = 60000;
export const GRID = Array.from({ length: 61 }, (_, k) => -60 + k * 5); // −60 … +240 min, every 5 min
export const MIN_CLEAN = 2;

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

// How long after eating a response is followed, and when later food still leaves a usable response: a drink peaks in
// 30–60 minutes and a meal in 1–2 hours, so food after that point cuts the curve there instead of discarding it.
export type Speed = 'meal' | 'quick';
export const WINDOW: Record<Speed, number> = { meal: 180, quick: 120 };
export const CUT_AFTER: Record<Speed, number> = { meal: 60, quick: 40 };
const SMALL_G = 5;          // a bite under this many grams of carbs does not disturb the response
const MIN_COVERAGE = 0.7;   // share of the followed time with readings

export interface Assessment { reasons: string[]; until: number }

/**
 * Whether one eating time shows its own response, and up to when. Other food, a hypo treatment or a correction dose
 * before CUT_AFTER minutes makes it unusable; after that the response is kept up to that moment. Exercise around it,
 * or too few readings, makes it unusable. `own` are the ids of this eating time itself (never counted against it).
 */
export function assess(t0: number, own: Set<string>, history: HistoryEntry[], events: EventRow[], s: Series, speed: Speed = 'meal'): Assessment {
  const end = t0 + WINDOW[speed] * MIN;
  const why: string[] = [];
  let first: { t: number; why: string } | null = null;
  const hit = (iso: string, w: string) => { const t = Date.parse(iso); if (t > t0 && t <= end && (!first || t < first.t)) first = { t, why: w }; };
  for (const h of history) if (!own.has(h.id) && (h.total_carbs ?? 0) >= SMALL_G) hit(h.eaten_at, t('أكل آخر'));
  for (const e of events) {
    if (e.deleted_at || own.has(e.id)) continue;
    if (e.kind === 'carbs' && (e.carbs_g ?? 0) >= SMALL_G) hit(e.occurred_at, t('كارب إضافي'));
    if (e.kind === 'treatment' && (e.carbs_g ?? 0) >= SMALL_G) hit(e.occurred_at, t('علاج انخفاض'));
    if (e.kind === 'insulin' && e.insulin_type !== 'long' && e.bolus_purpose === 'correction') hit(e.occurred_at, t('جرعة تصحيح'));
    if (e.kind === 'exercise') { const x = Date.parse(e.occurred_at); if (x >= t0 - 60 * MIN && x <= end) why.push(t('رياضة')); }
  }
  const f = first as { t: number; why: string } | null;
  if (f && f.t - t0 < CUT_AFTER[speed] * MIN) why.push(f.why);
  const until = f ? f.t : end;
  if (coverage(s, t0, (until - t0) / MIN) < MIN_COVERAGE) why.push(t('قراءات ناقصة'));
  return { reasons: [...new Set(why)], until };
}

export interface Occurrence { meal: HistoryEntry; t0: number; series: Series; response: MealResponse; reasons: string[]; curve: (number | null)[]; until: number }

/** Glucose at each grid offset: the nearest reading within ±5 min, never across a gap. */
export function alignCurve(s: Series, t0: number): (number | null)[] {
  return GRID.map((o) => { const i = nearest(s, t0 + o * MIN, 5 * MIN); return i === null ? null : s.v[i]; });
}

/** One eating time: its readings up to where its own response ends, the response and why it may not count. */
export function buildOccurrence(meal: HistoryEntry, s: Series, history: HistoryEntry[], events: EventRow[], now = Date.now(), speed: Speed = 'meal', own: string[] = []): Occurrence {
  const t0 = Date.parse(meal.eaten_at);
  const a = assess(t0, new Set([meal.id, ...own]), history, events, s, speed);
  const k = s.t.findIndex((x) => x > a.until);
  const cut: Series = k < 0 ? s : { ...s, t: s.t.slice(0, k), v: s.v.slice(0, k) };
  return { meal, t0, series: cut, response: mealResponse(cut, t0, events, now), reasons: a.reasons, curve: alignCurve(cut, t0), until: a.until };
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
    // the rise for every 10 g of carbs: compares different amounts of the same food, and foods with each other
    per10: median(clean.map((o) => (o.response.rise !== null && o.meal.total_carbs !== null && o.meal.total_carbs > 0 ? (o.response.rise / o.meal.total_carbs) * 10 : null))),
    lowStarts: clean.filter((o) => (o.response.g0 ?? 999) < 70).length,
  };
}
