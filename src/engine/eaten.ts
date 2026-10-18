// «شكثر أكلت؟» on a meal that is already in the log (saved with its dose): the part she ate is taken from the meal as
// it is now, including any correction the parents made to it after the dose, never rebuilt from the plan's original
// foods (that lost the correction). A second answer replaces the first: the meal is scaled from the earlier part.
import { scaleLines } from '../lib/edit';

export const TOTALS = ['total_carbs', 'total_fat', 'total_fiber', 'total_protein', 'total_kcal', 'total_sat_fat', 'total_sugar_added',
  'total_sodium', 'total_calcium', 'total_iron', 'total_potassium', 'total_vit_d'] as const;
type Totals = { [K in (typeof TOTALS)[number]]?: number | string | null };

export function eatenFromLogged<L extends { quantity?: number | null; carbs?: number | null }>(h: Totals & { lines: L[] }, part: number, prevPart = 1) {
  const f = part / (prevPart > 0 ? prevPart : 1);
  const totals: Record<string, number | null> = {};
  for (const k of TOTALS) { const v = h[k]; totals[k] = v == null ? null : Math.round(Number(v) * f * 10) / 10; }
  return { lines: scaleLines(h.lines, f), totals, carbs: totals.total_carbs ?? 0 };
}
