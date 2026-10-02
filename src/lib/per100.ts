// Labels print nutrition per 100 ml or 100 g; the family gives the pack size and the app works out the serving.
export interface Nutr { carbs: number | null; fat: number | null; protein: number | null; fiber: number | null; kcal: number | null }
export const EMPTY: Nutr = { carbs: null, fat: null, protein: null, fiber: null, kcal: null };
const r1 = (x: number) => Math.round(x * 10) / 10;

/** The serving from per-100 values and the amount eaten (ml or g). Grams to 0.1, energy to whole kcal. */
export function fromPer100(p: Nutr, amount: number | null): Nutr {
  if (amount === null || !(amount > 0)) return EMPTY;
  const f = amount / 100, g = (v: number | null) => (v === null ? null : r1(v * f));
  return { carbs: g(p.carbs), fat: g(p.fat), protein: g(p.protein), fiber: g(p.fiber), kcal: p.kcal === null ? null : Math.round(p.kcal * f) };
}

export interface NutrState { mode: 'serving' | 'per100'; serving: Nutr; per100: Nutr; amount: number | null; unit: 'ml' | 'g' }
export const totalsOf = (s: NutrState): Nutr => (s.mode === 'serving' ? s.serving : fromPer100(s.per100, s.amount));

/** What is wrong, if anything. Per 100 g nothing can exceed 100 g, which catches a serving typed as per-100. */
export function nutrProblem(s: NutrState): 'carbs' | 'per100' | 'amount' | 'values' | null {
  const ok = (v: number | null, max: number) => v === null || (v >= 0 && v <= max);
  if (s.mode === 'per100') {
    const p = s.per100;
    if (p.carbs === null) return 'carbs';
    if (![p.carbs, p.fat, p.protein, p.fiber].every((v) => ok(v, 100)) || !ok(p.kcal, 900)) return 'per100';
    if (s.amount === null || !(s.amount > 0 && s.amount <= 5000)) return 'amount';
  }
  const t = totalsOf(s);
  if (t.carbs === null) return 'carbs';
  if (![t.carbs, t.fat, t.protein, t.fiber].every((v) => ok(v, 300)) || !ok(t.kcal, 3000)) return 'values';
  return null;
}
