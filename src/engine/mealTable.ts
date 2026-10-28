// The mom's «الوجبات» table: one line per meal with the glucose when she ate and two hours later, and the NovoRapid
// given with it. Pure: the page hands in the meals, the rapid doses and the readings.
import { lowerBound, type Series } from './series';

const MIN = 60000;
/** How long after the meal the second number is read. */
export const AFTER_MIN = 120;
/** A rapid dose this close to the meal (either side) is the meal's dose. */
export const DOSE_WINDOW_MIN = 15;
/** A reading counts for a moment when it is this close to it. */
const READ_TOL_MIN = 10;

export interface MealIn { id: string; t: number; name: string; carbs: number | null }
export interface DoseIn { id: string; t: number; units: number }
export interface MealRow {
  id: string; t: number; name: string; carbs: number | null;
  /** units of the rapid dose given with the meal, null when none within the window */
  dose: number | null;
  /** mg/dL when she ate, null when the sensor had no reading then */
  atMg: number | null;
  /** mg/dL two hours later; null when not there (yet) */
  afterMg: number | null;
  /** minutes still to wait for the two-hour number; 0 once it is due */
  waitMin: number;
}

/** The reading nearest to t within READ_TOL_MIN, or null. */
export function readingNear(s: Series | null, t: number): number | null {
  if (!s || !s.t.length) return null;
  const i = lowerBound(s.t, t);
  let best = -1;
  for (const k of [i - 1, i]) if (k >= 0 && k < s.t.length && Math.abs(s.t[k] - t) <= READ_TOL_MIN * MIN && (best < 0 || Math.abs(s.t[k] - t) < Math.abs(s.t[best] - t))) best = k;
  return best < 0 ? null : s.v[best];
}

/** Each dose goes to the one meal nearest to it (within the window); a meal shows the sum of its doses. */
export function doseOfMeal(meals: MealIn[], doses: DoseIn[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of doses) {
    let best: MealIn | null = null;
    for (const m of meals) if (Math.abs(m.t - d.t) <= DOSE_WINDOW_MIN * MIN && (!best || Math.abs(m.t - d.t) < Math.abs(best.t - d.t))) best = m;
    if (best) out.set(best.id, (out.get(best.id) ?? 0) + d.units);
  }
  return out;
}

/** Rows newest first. */
export function mealTable(meals: MealIn[], doses: DoseIn[], series: Series | null, now: number): MealRow[] {
  const dose = doseOfMeal(meals, doses);
  return [...meals].sort((a, b) => b.t - a.t).map((m) => {
    const due = m.t + AFTER_MIN * MIN;
    return { id: m.id, t: m.t, name: m.name, carbs: m.carbs, dose: dose.get(m.id) ?? null, atMg: readingNear(series, m.t), afterMg: now >= due ? readingNear(series, due) : null, waitMin: Math.max(0, Math.ceil((due - now) / MIN)) };
  });
}
