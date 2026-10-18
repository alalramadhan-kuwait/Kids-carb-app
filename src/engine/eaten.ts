// «شكثر أكلت؟» on a meal that is already in the log (saved with its dose): the part she ate is taken from the meal as
// it is now, including any correction the parents made to it after the dose, never rebuilt from the plan's original
// foods (that lost the correction). A second answer replaces the first: the meal is scaled from the earlier part.
// Amounts and carbs keep three decimals (shown rounded) so «نصها» then «كلها» gives back exactly what was served.
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const TOTALS = ['total_carbs', 'total_fat', 'total_fiber', 'total_protein', 'total_kcal', 'total_sat_fat', 'total_sugar_added',
  'total_sodium', 'total_calcium', 'total_iron', 'total_potassium', 'total_vit_d'] as const;
type Totals = { [K in (typeof TOTALS)[number]]?: number | string | null };

export function eatenFromLogged<L extends { quantity?: number | null; carbs?: number | null }>(h: Totals & { lines: L[] }, part: number, prevPart = 1) {
  const f = part / (prevPart > 0 ? prevPart : 1);
  const totals: Record<string, number | null> = {};
  for (const k of TOTALS) { const v = h[k]; totals[k] = v == null ? null : r3(Number(v) * f); }
  const lines = h.lines.map((l) => ({ ...l, quantity: l.quantity == null ? l.quantity : r3(l.quantity * f), carbs: l.carbs == null ? l.carbs : r3(l.carbs * f) }));
  return { lines, totals, carbs: totals.total_carbs ?? 0 };
}
