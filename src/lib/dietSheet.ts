// The dietitian's daily sheet (one A4 page a day): her five columns (breakfast, snack 1, lunch, snack 2, dinner) and
// five rows (the meal, carbs, glucose before eating, glucose 2 hours after, insulin), plus what a dietitian also
// needs: fat, protein and calories, the change after the meal, a fatty-meal note, a late rise after a fatty meal,
// low treatments kept apart from meals, and the day's totals and glucose. It only reports what was logged and read;
// nothing here suggests a dose. Pure, tested in Node with made-up data.
import { isFatty } from '../engine/iob';
import { lowerBound, type Series } from '../engine/series';

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export type SlotKey = 'breakfast' | 'snack1' | 'lunch' | 'snack2' | 'dinner';
export const SLOT_KEYS: SlotKey[] = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner'];
/** Where each column starts, in minutes after midnight (Kuwait); dinner runs to midnight, earlier is "night". */
export interface SlotStarts { breakfast: number; snack1: number; lunch: number; snack2: number; dinner: number }
export const DEFAULT_STARTS: SlotStarts = { breakfast: 5 * 60, snack1: 10 * 60, lunch: 12 * 60, snack2: 16 * 60, dinner: 19 * 60 };

export const AFTER_MIN = 120;          // "after eating" = 2 hours after the start of the meal (the usual check)
export const BUMP = { fromMin: 120, toMin: 300, riseMg: 36 } as const; // a late rise: +2 mmol/L between 2 and 5 h

export interface Food { t: number; name: string; detail: string | null; carbs: number; fat: number | null; protein: number | null; kcal: number | null; fiber: number | null }
export interface Dose { t: number; units: number; type: 'rapid' | 'long'; purpose: string | null }
export interface Prick { t: number; mg: number }
export interface Treat { t: number; name: string; carbs: number }
export interface Activity { t: number; text: string }

export interface Reading { mg: number; t: number; prick: boolean }
export interface Bump { rise: number; peakAt: number; fromMg: number; toMg: number }
export interface Slot {
  key: SlotKey; foods: Food[]; carbs: number; fat: number | null; protein: number | null; kcal: number | null; fiber: number | null;
  start: number | null; before: Reading | null; after: Reading | null; afterNextMeal: boolean; doses: Dose[];
  fatty: boolean; noFatData: boolean; bump: Bump | null;
}
export interface DaySheet {
  start: number; slots: Slot[]; night: Food[]; treatments: Treat[]; otherDoses: Dose[]; basal: Dose[]; activities: Activity[];
  totals: { carbs: number; fat: number | null; protein: number | null; kcal: number | null; rapid: number; basal: number; treatmentCarbs: number };
  glucose: { n: number; mean: number | null; inRange: number | null; below: number | null; above: number | null; min: number | null; max: number | null };
  lows: { t: number; nadir: number; minutes: number }[];
  /** the day's readings, for the graph */
  points: [number, number][];
}

/** The reading nearest to t within tol minutes. */
export function readingAt(s: Series, t: number, tolMin: number): { t: number; mg: number } | null {
  const i = lowerBound(s.t, t);
  let best: number | null = null;
  for (const k of [i - 1, i]) if (k >= 0 && k < s.t.length && Math.abs(s.t[k] - t) <= tolMin * MIN && (best === null || Math.abs(s.t[k] - t) < Math.abs(s.t[best] - t))) best = k;
  return best === null ? null : { t: s.t[best], mg: s.v[best] };
}

/**
 * A late rise after a meal: between 2 and 5 hours, the highest reading that comes after the lowest one, at least
 * 2 mmol/L above it, with nothing else eaten from 90 minutes after the meal until that peak.
 */
export function lateBump(s: Series, t0: number, otherFood: number[]): Bump | null {
  const from = t0 + BUMP.fromMin * MIN, to = t0 + BUMP.toMin * MIN;
  let lo: number | null = null, best: Bump | null = null;
  for (let i = lowerBound(s.t, from); i < s.t.length && s.t[i] <= to; i++) {
    if (lo === null || s.v[i] < s.v[lo]) { lo = i; continue; }
    const rise = s.v[i] - s.v[lo];
    if (rise >= BUMP.riseMg && (!best || rise > best.rise)) best = { rise, peakAt: s.t[i], fromMg: s.v[lo], toMg: s.v[i] };
  }
  if (best && otherFood.some((t) => t > t0 + 90 * MIN && t <= best!.peakAt)) return null;
  return best;
}

const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x === null) ? (xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0)) : xs.reduce<number>((a, x) => a + (x as number), 0));

/** Which column a time of day falls in; null before breakfast (night). */
export function slotOf(minuteOfDay: number, starts: SlotStarts): SlotKey | null {
  if (minuteOfDay < starts.breakfast) return null;
  let cur: SlotKey = 'breakfast';
  for (const k of SLOT_KEYS) if (minuteOfDay >= starts[k]) cur = k;
  return cur;
}

export function buildDay(start: number, starts: SlotStarts, d: { foods: Food[]; doses: Dose[]; pricks: Prick[]; treatments: Treat[]; activities: Activity[]; series: Series; low: number; high: number }): DaySheet {
  const end = start + DAY;
  const inDay = (t: number) => t >= start && t < end;
  const foods = d.foods.filter((f) => inDay(f.t)).sort((a, b) => a.t - b.t);
  const night: Food[] = [];
  const by = new Map<SlotKey, Food[]>(SLOT_KEYS.map((k) => [k, []]));
  for (const f of foods) { const k = slotOf(Math.floor((f.t - start) / MIN), starts); if (k) by.get(k)!.push(f); else night.push(f); }
  const allFoodTimes = [...d.foods.map((f) => f.t), ...d.treatments.map((x) => x.t)];
  const mealStarts = SLOT_KEYS.map((k) => by.get(k)![0]?.t).filter((t): t is number => t !== undefined);

  const rapid = d.doses.filter((x) => x.type === 'rapid' && inDay(x.t));
  const used = new Set<Dose>();
  const slots: Slot[] = SLOT_KEYS.map((key) => {
    const fs = by.get(key)!;
    const t0 = fs[0]?.t ?? null, tLast = fs[fs.length - 1]?.t ?? null;
    let before: Reading | null = null, after: Reading | null = null, bump: Bump | null = null, afterNextMeal = false;
    const doses: Dose[] = [];
    if (t0 !== null && tLast !== null) {
      const prick = d.pricks.filter((p) => Math.abs(p.t - t0) <= 15 * MIN).sort((a, b) => Math.abs(a.t - t0) - Math.abs(b.t - t0))[0];
      const cgm = readingAt(d.series, t0, 10);
      before = prick ? { mg: prick.mg, t: prick.t, prick: true } : cgm ? { ...cgm, prick: false } : null;
      const a = readingAt(d.series, t0 + AFTER_MIN * MIN, 10);
      after = a ? { ...a, prick: false } : null;
      afterNextMeal = mealStarts.some((t) => t > tLast && t < t0 + AFTER_MIN * MIN);
      // the meal's insulin: rapid doses from 45 minutes before the first food to 30 minutes after the last
      for (const x of rapid) if (!used.has(x) && x.t >= t0 - 45 * MIN && x.t <= tLast + 30 * MIN) { doses.push(x); used.add(x); }
      bump = lateBump(d.series, t0, allFoodTimes.filter((t) => t > tLast));
    }
    const fat = sumOrNull(fs.map((f) => f.fat)), protein = sumOrNull(fs.map((f) => f.protein));
    return {
      key, foods: fs, carbs: fs.reduce((a, f) => a + f.carbs, 0), fat, protein, kcal: sumOrNull(fs.map((f) => f.kcal)), fiber: sumOrNull(fs.map((f) => f.fiber)),
      start: t0, before, after, afterNextMeal, doses, fatty: fs.length > 0 && isFatty(fat, protein), noFatData: fs.length > 0 && fat === null, bump,
    };
  });

  // the day's glucose (readings inside the day)
  let n = 0, sum = 0, lo = 0, hi = 0, inR = 0, min: number | null = null, max: number | null = null;
  for (let i = lowerBound(d.series.t, start); i < d.series.t.length && d.series.t[i] < end; i++) {
    const v = d.series.v[i]; n++; sum += v;
    if (v < d.low) lo++; else if (v > d.high) hi++; else inR++;
    min = min === null ? v : Math.min(min, v); max = max === null ? v : Math.max(max, v);
  }
  const pct = (x: number) => (n ? Math.round((x / n) * 100) : null);
  const lows: DaySheet['lows'] = [];
  let run: { t: number; nadir: number; last: number } | null = null;
  const close = () => { if (run && run.last - run.t >= 10 * MIN) lows.push({ t: run.t, nadir: run.nadir, minutes: Math.round((run.last - run.t) / MIN) }); run = null; };
  for (let i = lowerBound(d.series.t, start); i < d.series.t.length && d.series.t[i] < end; i++) {
    const t = d.series.t[i], v = d.series.v[i];
    if (run && t - run.last > 15 * MIN) close();
    if (v < d.low) { if (!run) run = { t, nadir: v, last: t }; else { run.nadir = Math.min(run.nadir, v); run.last = t; } } else close();
  }
  close();

  const points: [number, number][] = [];
  for (let i = lowerBound(d.series.t, start); i < d.series.t.length && d.series.t[i] < end; i++) points.push([d.series.t[i], d.series.v[i]]);
  const treatments = d.treatments.filter((x) => inDay(x.t)).sort((a, b) => a.t - b.t);
  const basal = d.doses.filter((x) => x.type === 'long' && inDay(x.t));
  const dayFoods = foods;
  return {
    start, slots, night, treatments, basal,
    otherDoses: rapid.filter((x) => !used.has(x)).sort((a, b) => a.t - b.t),
    activities: d.activities.filter((x) => inDay(x.t)).sort((a, b) => a.t - b.t),
    totals: {
      carbs: dayFoods.reduce((a, f) => a + f.carbs, 0), fat: sumOrNull(dayFoods.map((f) => f.fat)), protein: sumOrNull(dayFoods.map((f) => f.protein)),
      kcal: sumOrNull(dayFoods.map((f) => f.kcal)), rapid: rapid.reduce((a, x) => a + x.units, 0), basal: basal.reduce((a, x) => a + x.units, 0),
      treatmentCarbs: treatments.reduce((a, x) => a + x.carbs, 0),
    },
    glucose: { n, mean: n ? sum / n : null, inRange: pct(inR), below: pct(lo), above: pct(hi), min, max },
    lows, points,
  };
}
