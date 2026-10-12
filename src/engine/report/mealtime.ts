// Clinical report engine, part 11: Mealtime Patterns (LibreView's report): how glucose moves around breakfast, lunch,
// dinner and snacks. For each meal period: the glucose before the meal, its median curve (with the middle half of
// sittings) from 1 hour before to 4 hours after, the rise, the 2-hour value, how often a low followed, and the carbs
// and insulin given. Everything is read from the stored readings on the shared 5-minute grid (cgm.ts): a time with no
// sensor data is missing for that sitting, never filled in, and a point needs at least MIN_SITTINGS sittings.
//
// A "sitting" is everything eaten within SITTING_MIN of the first bite. A sitting ends where the next one starts, so
// one meal's curve never carries the next meal. Something eaten while she was low is a low treatment, not a meal.
import { MIN, grid, kwDayKey, kwMinuteOfDay, type Reading } from './cgm';
import { PERIOD_BOUNDS, SNACK_G as PERIOD_SNACK_G, periodOf } from '../mealPeriod';
import { glucoseEvents } from './events';
import { mmol } from './agpReport';
import type { ReportInsulin, ReportMeal } from './days';

export const SITTING_MIN = 30, BEFORE_MIN = 60, AFTER_MIN = 240, STEP_MIN = 15, MIN_SITTINGS = 3;
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
/** Under this many grams a sitting is a snack, whatever the hour (the shared rule in engine/mealPeriod.ts). */
export const SNACK_G = PERIOD_SNACK_G;

export interface Sitting { at: number; slot: MealSlot; carbs: number | null; meals: number; insulin: number | null; pre: number | null; at2h: number | null; peak: number | null; peakMin: number | null; lowAfter: boolean; end: number }
export interface MealtimeSlot {
  slot: MealSlot; sittings: number;
  carbs: number | null;         // median known grams per sitting
  unknownCarbs: number;         // sittings with carbs not known
  insulin: number | null;       // median rapid insulin given from 30 min before to 30 min after
  withInsulin: number;          // sittings that had a dose
  pre: number | null; at2h: number | null; rise: number | null; peakMin: number | null; // mmol/L medians; minutes
  lowsAfter: number;            // sittings followed by a low event within 4 h
  curve: { min: number; p25: number; p50: number; p75: number; n: number }[]; // mmol/L, offsets −60…+240
}
export interface Mealtime { from: number; to: number; slots: MealtimeSlot[]; sittings: Sitting[]; treatmentsLeftOut: number }

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

/** The meal period by the clock (engine/mealPeriod.ts): breakfast to 11, lunch 1–5 pm, dinner from 5 pm; a stored
 *  snack stays a snack, a stored meal name does not override the time. */
export function slotOf(at: number, carbs: number | null, stored: string | null | undefined): MealSlot {
  return periodOf(kwMinuteOfDay(at), carbs, stored);
}

export function buildMealtime(o: { readings: Reading[]; from: number; to: number; now: number; meals: ReportMeal[]; insulin: ReportInsulin[] }): Mealtime {
  const end = Math.min(o.to, o.now);
  const g = grid(o.readings, o.from - BEFORE_MIN * MIN, end + AFTER_MIN * MIN);
  const t0 = g.length ? g[0].t : 0, SL = 5 * MIN;
  const at = (t: number) => { const k = Math.floor((t - t0) / SL); return k >= 0 && k < g.length ? g[k].mg : null; };
  const lows = glucoseEvents(o.readings, o.from - BEFORE_MIN * MIN, end + AFTER_MIN * MIN).hypo1;

  // sittings: meals eaten (confirmed) inside the period, grouped by SITTING_MIN from the first
  const eaten = o.meals.filter((m) => !m.pending && m.at >= o.from && m.at < end).sort((a, b) => a.at - b.at);
  const groups: ReportMeal[][] = [];
  for (const m of eaten) { const last = groups[groups.length - 1]; if (last && m.at - last[0].at <= SITTING_MIN * MIN) last.push(m); else groups.push([m]); }
  let treatmentsLeftOut = 0;
  const sittings: Sitting[] = [];
  groups.forEach((grp, i) => {
    const t = grp[0].at;
    const pre = at(t - 5 * MIN) ?? at(t);
    if (pre !== null && pre < 70) { treatmentsLeftOut++; return; } // eaten while low: a treatment, not a meal
    const known = grp.every((m) => !m.unknown && m.carbs !== null);
    const carbs = known ? grp.reduce((s, m) => s + (m.carbs ?? 0), 0) : null;
    const next = groups[i + 1]?.[0].at ?? Infinity;
    const stop = Math.min(next, t + AFTER_MIN * MIN, end);
    const doses = o.insulin.filter((d) => d.type === 'rapid' && d.at >= t - 30 * MIN && d.at <= t + 30 * MIN);
    let peak: number | null = null, peakMin: number | null = null;
    for (let m = 0; t + m * MIN < stop; m += 5) { const v = at(t + m * MIN); if (v !== null && (peak === null || v > peak)) { peak = v; peakMin = m; } }
    const two = t + 120 * MIN < stop ? at(t + 120 * MIN) : null;
    sittings.push({
      at: t, slot: slotOf(t, carbs, grp.find((m) => m.slot)?.slot), carbs, meals: grp.length,
      insulin: doses.length ? doses.reduce((s, d) => s + d.units, 0) : null,
      pre, at2h: two, peak, peakMin, end: stop,
      lowAfter: lows.some((e) => e.start > t && e.start < stop),
    });
  });

  // a day with no breakfast: its first real meal before lunch time (20 g or more, or with a dose) was her breakfast
  const BREAKFAST_MIN_G = 20, firstOfDay = new Map<string, Sitting>();
  for (const s of sittings) if (!firstOfDay.has(kwDayKey(s.at))) firstOfDay.set(kwDayKey(s.at), s);
  for (const [day, s] of firstOfDay) {
    const m = kwMinuteOfDay(s.at);
    if (sittings.some((x) => kwDayKey(x.at) === day && x.slot === 'breakfast')) continue;
    if (s.slot === 'snack' && m >= PERIOD_BOUNDS.breakfast && m < PERIOD_BOUNDS.lunch && ((s.carbs ?? BREAKFAST_MIN_G) >= BREAKFAST_MIN_G || s.insulin !== null)) s.slot = 'breakfast';
  }

  const slots = SLOTS.map((slot): MealtimeSlot => {
    const ss = sittings.filter((s) => s.slot === slot);
    const num = (f: (s: Sitting) => number | null) => ss.map(f).filter((v): v is number => v !== null);
    const curve: MealtimeSlot['curve'] = [];
    for (let m = -BEFORE_MIN; m <= AFTER_MIN; m += STEP_MIN) {
      const vs = ss.filter((s) => s.at + m * MIN < s.end).map((s) => at(s.at + m * MIN)).filter((v): v is number => v !== null).map(mmol);
      if (vs.length >= MIN_SITTINGS) curve.push({ min: m, p25: q(vs, 0.25), p50: q(vs, 0.5), p75: q(vs, 0.75), n: vs.length });
    }
    const pre = median(num((s) => s.pre)), two = median(num((s) => s.at2h));
    return {
      slot, sittings: ss.length, carbs: median(num((s) => s.carbs)), unknownCarbs: ss.filter((s) => s.carbs === null).length,
      insulin: median(num((s) => s.insulin)), withInsulin: ss.filter((s) => s.insulin !== null).length,
      pre: pre === null ? null : mmol(pre), at2h: two === null ? null : mmol(two),
      rise: median(ss.filter((s) => s.pre !== null && s.peak !== null).map((s) => mmol(s.peak! - s.pre!))),
      peakMin: median(num((s) => s.peakMin)), lowsAfter: ss.filter((s) => s.lowAfter).length, curve,
    };
  });
  return { from: o.from, to: o.to, slots, sittings, treatmentsLeftOut };
}

export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };
export const MEALTIME_NOTE = 'A sitting is everything eaten within 30 minutes. Meal periods follow the time eaten (Kuwait): breakfast 4–11 am, lunch 1–5 pm, dinner from 5 pm; under 15 g, 11 am–1 pm or after midnight: snack (a day\'s first real meal before 1 pm is its breakfast). Food eaten while below 3.9 counts as a low treatment and is left out. Each curve stops where the next sitting starts; missing sensor data is never filled in; a point needs 3 sittings. Insulin: rapid doses given from 30 min before to 30 min after.';
