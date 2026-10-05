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

/** One ingredient of a logged entry, as logged (the page formats the amount). */
export interface Line { name: string; quantity: number | null; unit: string | null; carbs: number | null; productKey: string | null; /** the name came from the catalogue in the page's language */ named?: boolean }
export type Flag = 'estimate' | 'imported' | 'review' | 'recipe' | 'unnamed' | 'duplicate';
export interface Food {
  t: number; name: string; detail: string | null; carbs: number; fat: number | null; protein: number | null; kcal: number | null; fiber: number | null;
  id?: string;
  /** the name came from the catalogue in the page's language (no † needed) */
  named?: boolean;
  /** the meal it was planned as (breakfast…dinner, or 'snack'); wins over the clock */
  slot?: SlotKey | 'snack' | null;
  /** a recipe or a planned meal is never a low treatment, whatever its size */
  recipe?: boolean; planned?: boolean;
  lines?: Line[]; note?: string | null; flags?: Flag[];
  /** part of the planned meal eaten (0–1) and the planned carbs */
  partEaten?: number | null; carbsPlanned?: number | null;
}
export interface Dose {
  t: number; units: number; type: 'rapid' | 'long'; purpose: string | null;
  id?: string;
  /** the meal entry this dose was given for (from the plan), when known */
  forFood?: string | null;
  /** what the calculator said: units for food and for correction, and the carbs it was worked out for */
  calc?: { food: number; correction: number; carbs: number | null; suggested: number | null } | null;
}
export interface Prick { t: number; mg: number }
export interface Treat {
  t: number; name: string; carbs: number; named?: boolean;
  /** found by the sensor (a small snack logged while she was low), not logged as a treatment */
  byCgm?: boolean;
  startMg?: number | null; lowestMg?: number | null; after15?: number | null; followedByFood?: boolean; duplicate?: boolean;
}
export interface Activity { t: number; text: string }

export interface Reading { mg: number; t: number; prick: boolean }
export interface Bump { rise: number; peakAt: number; fromMg: number; toMg: number }
/** A sum that may be missing parts: v is what is known, partial when some items had no value. */
export interface Sum { v: number | null; partial: boolean }
/** One time she ate within a column (items less than 30 minutes apart). */
export interface Occasion {
  t: number; foods: Food[]; carbs: number; fat: Sum; protein: Sum; kcal: Sum; fiber: Sum;
  before: Reading | null; after: Reading | null;
  /** what else happened between eating and the 2-hour reading, so the reading is not the meal's alone */
  affected: { kind: 'food' | 'treatment' | 'correction'; t: number }[];
  startedLow: boolean;
  /** the lowest reading within 4 hours, when it went below range */
  lowAfter: { mg: number; t: number } | null;
  doses: Dose[]; fatty: boolean; noFatData: boolean; bump: Bump | null;
}
export interface Slot {
  key: SlotKey; occasions: Occasion[];
  // the column as a whole (first occasion for times and readings), kept for the summary and the tests
  foods: Food[]; carbs: number; fat: number | null; protein: number | null; kcal: number | null; fiber: number | null;
  start: number | null; before: Reading | null; after: Reading | null; afterNextMeal: boolean; doses: Dose[];
  fatty: boolean; noFatData: boolean; bump: Bump | null;
}
export interface DaySheet {
  start: number; slots: Slot[]; night: Food[]; treatments: Treat[]; otherDoses: Dose[]; basal: Dose[]; activities: Activity[];
  totals: { carbs: number; fat: number | null; protein: number | null; kcal: number | null; rapid: number; basal: number; treatmentCarbs: number; partial: { fat: boolean; protein: boolean; kcal: boolean } };
  glucose: { n: number; mean: number | null; inRange: number | null; below: number | null; above: number | null; min: number | null; max: number | null };
  lows: { t: number; nadir: number; minutes: number }[];
  /** the day's readings, for the graph */
  points: [number, number][];
  /** nothing logged and no readings: "not recorded"; readings start late: from when */
  recorded: boolean; cgmFrom: number | null;
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

/** Missing values are not zero: the known part, marked partial. */
export const sumOf = (xs: (number | null)[]): Sum => ({ v: xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0), partial: xs.some((x) => x === null) && xs.some((x) => x !== null) });
const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x === null) ? (xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0)) : xs.reduce<number>((a, x) => a + (x as number), 0));

/** Which column a time of day falls in; null before breakfast (night). */
export function slotOf(minuteOfDay: number, starts: SlotStarts): SlotKey | null {
  if (minuteOfDay < starts.breakfast) return null;
  let cur: SlotKey = 'breakfast';
  for (const k of SLOT_KEYS) if (minuteOfDay >= starts[k]) cur = k;
  return cur;
}

export const TREAT_MAX_G = 25;          // a low treatment is small: a meal started during a low is still a meal
export const OCCASION_GAP_MIN = 30;     // items closer than this are one time she ate
export const TREAT_WORKS_MIN = 10;      // a treatment counts as done (she is back in range because of it) after this long

/** The sensor was below the low limit in the 30 minutes up to t (a low after she started eating does not count). */
export function lowAround(s: Series, t: number, low: number): boolean {
  for (let i = lowerBound(s.t, t - 30 * MIN); i < s.t.length && s.t[i] <= t; i++) if (s.v[i] < low) return true;
  return false;
}
/** A small item eaten while she was low (not a recipe or a planned meal) was a low treatment, even next to a meal. */
export const isTreatment = (f: Food, s: Series, low: number) =>
  !f.recipe && !f.planned && f.carbs > 0 && f.carbs <= TREAT_MAX_G && lowAround(s, f.t, low);
export const BREAKFAST_MIN_G = 20;      // the morning's first real meal: at least this much, or insulin given for it

function minIn(s: Series, from: number, to: number): { mg: number; t: number } | null {
  let best: { mg: number; t: number } | null = null;
  for (let i = lowerBound(s.t, from); i < s.t.length && s.t[i] <= to; i++) if (!best || s.v[i] < best.mg) best = { mg: s.v[i], t: s.t[i] };
  return best;
}

export function buildDay(start: number, starts: SlotStarts, d: { foods: Food[]; doses: Dose[]; pricks: Prick[]; treatments: Treat[]; activities: Activity[]; series: Series; low: number; high: number }): DaySheet {
  const end = start + DAY;
  const inDay = (t: number) => t >= start && t < end;
  // 1. low treatments: logged as such, or a small snack eaten while the sensor read low
  //    …unless that low was already treated and she is back in range when she eats (then it is just food)
  const treatAll: Treat[] = [...d.treatments];
  const foodsAll: Food[] = [];
  for (const f of [...d.foods].sort((a, b) => a.t - b.t)) {
    let treat = isTreatment(f, d.series, d.low);
    if (treat) {
      const now = readingAt(d.series, f.t, 10);
      let firstLow: number | null = null;
      for (let i = lowerBound(d.series.t, f.t - 30 * MIN); i < d.series.t.length && d.series.t[i] <= f.t; i++) if (d.series.v[i] < d.low) { firstLow = d.series.t[i]; break; }
      // the earlier treatment must have had time to work: something eaten with it (the juice, then crackers a minute
      // later) is part of the same treatment
      if (now && now.mg >= d.low && firstLow !== null && treatAll.some((x) => x.t >= firstLow! - 10 * MIN && x.t <= f.t - TREAT_WORKS_MIN * MIN)) treat = false;
    }
    if (treat) treatAll.push({ t: f.t, name: f.name, named: f.named, carbs: f.carbs, byCgm: true }); else foodsAll.push(f);
  }
  const foods = foodsAll.filter((f) => inDay(f.t)).sort((a, b) => a.t - b.t);
  // 2. columns: the meal it was planned as, else the clock
  const night: Food[] = [];
  const by = new Map<SlotKey, Food[]>(SLOT_KEYS.map((k) => [k, []]));
  for (const f of foods) {
    const minute = Math.floor((f.t - start) / MIN);
    const k = f.slot === 'snack' ? (minute < starts.lunch ? 'snack1' : 'snack2') : f.slot ?? slotOf(minute, starts);
    if (k) by.get(k)!.push(f); else night.push(f);
  }
  // no breakfast logged as such: the morning's first real meal (in Snack 1, not placed by a plan) is her breakfast
  const s1 = by.get('snack1')!;
  if (!by.get('breakfast')!.length && s1.length && !s1[0].slot) {
    const first: Food[] = [s1[0]];
    for (const f of s1.slice(1)) if (!f.slot && f.t - first[first.length - 1].t <= OCCASION_GAP_MIN * MIN) first.push(f); else break;
    const t0 = first[0].t, tLast = first[first.length - 1].t;
    const dosed = d.doses.some((x) => x.type === 'rapid' && x.t >= t0 - 45 * MIN && x.t <= tLast + 30 * MIN);
    if (dosed || first.reduce((a, f) => a + f.carbs, 0) >= BREAKFAST_MIN_G) { by.set('breakfast', first); by.set('snack1', s1.slice(first.length)); }
  }
  const otherFoodAt = foodsAll.map((f) => f.t);
  const treatAt = treatAll.map((x) => x.t);
  const mealStarts = SLOT_KEYS.map((k) => by.get(k)![0]?.t).filter((t): t is number => t !== undefined);

  const rapid = d.doses.filter((x) => x.type === 'rapid' && inDay(x.t)).sort((a, b) => a.t - b.t);
  const used = new Set<Dose>();
  // doses given for a known meal entry go with it first
  const linked = new Map<string, Dose[]>();
  for (const x of rapid) if (x.forFood) { linked.set(x.forFood, [...(linked.get(x.forFood) ?? []), x]); used.add(x); }

  const occasionOf = (fs: Food[]): Occasion => {
    const t0 = fs[0].t, tLast = fs[fs.length - 1].t;
    const prick = d.pricks.filter((p) => Math.abs(p.t - t0) <= 15 * MIN).sort((a, b) => Math.abs(a.t - t0) - Math.abs(b.t - t0))[0];
    const cgm = readingAt(d.series, t0, 10);
    const before: Reading | null = prick ? { mg: prick.mg, t: prick.t, prick: true } : cgm ? { ...cgm, prick: false } : null;
    const a = readingAt(d.series, t0 + AFTER_MIN * MIN, 10);
    const mine = new Set(fs);
    // the meal's insulin: the dose given for it, else rapid doses from 45 minutes before to 30 minutes after
    const doses: Dose[] = fs.flatMap((f) => (f.id ? linked.get(f.id) ?? [] : []));
    if (!doses.length) for (const x of rapid) if (!used.has(x) && x.t >= t0 - 45 * MIN && x.t <= tLast + 30 * MIN) { doses.push(x); used.add(x); }
    const win = (t: number) => t > tLast + 15 * MIN && t <= t0 + AFTER_MIN * MIN;
    const affected: Occasion['affected'] = [
      ...foodsAll.filter((f) => !mine.has(f) && win(f.t)).map((f) => ({ kind: 'food' as const, t: f.t })),
      ...treatAll.filter((x) => win(x.t)).map((x) => ({ kind: 'treatment' as const, t: x.t })),
      ...rapid.filter((x) => win(x.t) && !doses.includes(x)).map((x) => ({ kind: 'correction' as const, t: x.t })),
    ].sort((p, q) => p.t - q.t);
    const lo = minIn(d.series, t0, t0 + 4 * HOUR);
    const fat = sumOf(fs.map((f) => f.fat)), protein = sumOf(fs.map((f) => f.protein));
    return {
      t: t0, foods: fs, carbs: fs.reduce((x, f) => x + f.carbs, 0), fat, protein, kcal: sumOf(fs.map((f) => f.kcal)), fiber: sumOf(fs.map((f) => f.fiber)),
      before, after: a ? { ...a, prick: false } : null, affected,
      startedLow: before !== null && before.mg < d.low,
      lowAfter: lo && lo.mg < d.low && !(before && before.mg < d.low && lo.t - t0 < 30 * MIN) ? lo : null,
      doses, fatty: isFatty(fat.v, protein.v), noFatData: fat.v === null,
      bump: lateBump(d.series, t0, [...otherFoodAt, ...treatAt].filter((t) => t > tLast)),
    };
  };

  const slots: Slot[] = SLOT_KEYS.map((key) => {
    const fs = by.get(key)!;
    const groups: Food[][] = [];
    for (const f of fs) { const g = groups[groups.length - 1]; if (g && f.t - g[g.length - 1].t <= OCCASION_GAP_MIN * MIN) g.push(f); else groups.push([f]); }
    const occasions = groups.map(occasionOf);
    const first = occasions[0] ?? null;
    const tLast = fs[fs.length - 1]?.t ?? null;
    const fat = sumOrNull(fs.map((f) => f.fat)), protein = sumOrNull(fs.map((f) => f.protein));
    return {
      key, occasions, foods: fs, carbs: fs.reduce((a, f) => a + f.carbs, 0), fat, protein, kcal: sumOrNull(fs.map((f) => f.kcal)), fiber: sumOrNull(fs.map((f) => f.fiber)),
      start: first?.t ?? null, before: first?.before ?? null, after: first?.after ?? null,
      afterNextMeal: first !== null && tLast !== null && mealStarts.some((t) => t > tLast && t < first.t + AFTER_MIN * MIN),
      doses: occasions.flatMap((o) => o.doses), fatty: occasions.some((o) => o.fatty), noFatData: fs.length > 0 && fat === null, bump: first?.bump ?? null,
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
  // each treatment: glucose at the start, the lowest around it, 15 minutes later, and whether food followed
  const treatments = treatAll.filter((x) => inDay(x.t)).sort((a, b) => a.t - b.t).map((x, i, all) => ({
    ...x,
    startMg: readingAt(d.series, x.t, 10)?.mg ?? null,
    lowestMg: minIn(d.series, x.t - 30 * MIN, x.t + 30 * MIN)?.mg ?? null,
    after15: readingAt(d.series, x.t + 15 * MIN, 5)?.mg ?? null,
    followedByFood: foodsAll.some((f) => f.t > x.t && f.t <= x.t + 30 * MIN),
    duplicate: all.some((y, j) => j !== i && y.name === x.name && Math.abs(y.t - x.t) <= 15 * MIN),
  }));
  const basal = d.doses.filter((x) => x.type === 'long' && inDay(x.t));
  const dayFoods = foods;
  const fatS = sumOf(dayFoods.map((f) => f.fat)), protS = sumOf(dayFoods.map((f) => f.protein)), kcalS = sumOf(dayFoods.map((f) => f.kcal));
  return {
    start, slots, night, treatments, basal,
    otherDoses: rapid.filter((x) => !used.has(x)).sort((a, b) => a.t - b.t),
    activities: d.activities.filter((x) => inDay(x.t)).sort((a, b) => a.t - b.t),
    totals: {
      carbs: dayFoods.reduce((a, f) => a + f.carbs, 0), fat: fatS.v, protein: protS.v, kcal: kcalS.v,
      rapid: rapid.reduce((a, x) => a + x.units, 0), basal: basal.reduce((a, x) => a + x.units, 0),
      treatmentCarbs: treatments.reduce((a, x) => a + x.carbs, 0), partial: { fat: fatS.partial, protein: protS.partial, kcal: kcalS.partial },
    },
    glucose: { n, mean: n ? sum / n : null, inRange: pct(inR), below: pct(lo), above: pct(hi), min, max },
    lows, points,
    recorded: n > 0 || dayFoods.length > 0 || treatments.length > 0 || rapid.length > 0,
    cgmFrom: points.length && points[0][0] - start > 2 * HOUR ? points[0][0] : null,
  };
}
