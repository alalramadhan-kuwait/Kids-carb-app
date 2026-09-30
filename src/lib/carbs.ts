import type { Ingredient, Product, Role, Settings, Snack, State, Unit } from './types';

/**
 * The carb engine. One rule runs through all of it: never guess. If a number
 * cannot be computed from a registered, approved product, the line is marked
 * with a `problem` and contributes nothing, and the meal is flagged incomplete.
 */

export type Problem =
  | 'no_product' // nothing registered for this ingredient / category
  | 'unapproved' // the product exists but has not been approved
  | 'no_serving' // amount is in servings but the product has no serving size
  | 'no_yield' // cooked weight of a product whose label is for the uncooked food
  | 'unit_mismatch'; // grams entered for a product measured in ml (or the reverse)

export interface Line {
  ing: Ingredient;
  product: Product | null;
  /** amount in the product's own unit (g or ml), as measured on the plate */
  amount: number | null;
  /** amount as sold, after undoing cooking; what the label describes */
  labelAmount: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  protein: number | null;
  kcal: number | null;
  problem: Problem | null;
}

export type Level = 'normal' | 'near' | 'over';

export interface Nutrition {
  carbs: number;
  fat: number;
  fiber: number;
  protein: number;
  kcal: number;
}

export interface MealResult {
  lines: Line[];
  complete: boolean;
  total: Nutrition;
  /** some line lacks fat/fiber/protein/kcal data, so those totals are partial */
  nutritionPartial: boolean;
  byRole: Record<Role, number>;
  level: Level;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Find the product an ingredient means right now. */
export function resolveProduct(
  ing: Pick<Ingredient, 'product_id' | 'slot_category'>,
  products: Product[],
): { product: Product | null; problem: Problem | null } {
  if (ing.product_id) {
    const p = products.find((x) => x.id === ing.product_id);
    if (!p) return { product: null, problem: 'no_product' };
    return { product: p, problem: p.approved ? null : 'unapproved' };
  }
  const candidates = products.filter((p) => p.category === ing.slot_category);
  const approved = candidates.filter((p) => p.approved);
  if (approved.length) {
    // prefer what is in the pantry, then a stable order so the answer does not flicker
    const pool = approved.some((p) => p.available) ? approved.filter((p) => p.available) : approved;
    return { product: [...pool].sort((a, b) => a.name.localeCompare(b.name, 'ar'))[0], problem: null };
  }
  return { product: null, problem: candidates.length ? 'unapproved' : 'no_product' };
}

/** Amount on the plate in the product's unit, or the reason it cannot be known. */
function plateAmount(
  quantity: number,
  unit: Unit,
  p: Product,
  settings: Settings,
): { amount: number | null; problem: Problem | null } {
  if (unit === 'g' || unit === 'ml') {
    return unit === p.unit ? { amount: quantity, problem: null } : { amount: null, problem: 'unit_mismatch' };
  }
  if (unit === 'tbsp') return { amount: quantity * settings.tbsp_size, problem: null };
  if (!p.serving_size) return { amount: null, problem: 'no_serving' };
  return { amount: quantity * p.serving_size, problem: null };
}

export function computeLine(
  ing: Pick<Ingredient, 'product_id' | 'slot_category' | 'unit' | 'state'> & { quantity: number },
  products: Product[],
  settings: Settings,
): Omit<Line, 'ing'> {
  const empty = { product: null, amount: null, labelAmount: null, carbs: null, fat: null, fiber: null, protein: null, kcal: null };
  const { product, problem } = resolveProduct(ing, products);
  if (!product || problem) return { ...empty, product, problem };

  const plate = plateAmount(ing.quantity, ing.unit, product, settings);
  if (plate.amount === null) return { ...empty, product, problem: plate.problem };

  // The label describes the food as sold. Rice and pasta are weighed cooked, so
  // undo the cooking with the product's own measured yield. Never assume one.
  let labelAmount = plate.amount;
  if (ing.state === 'cooked' && product.label_basis === 'as_sold' && product.kind === 'commercial') {
    if (!product.cooked_yield) return { ...empty, product, amount: plate.amount, problem: 'no_yield' };
    labelAmount = plate.amount / product.cooked_yield;
  }

  const per = (v: number | null) => (v === null ? null : (v * labelAmount) / 100);
  return {
    product,
    problem: null,
    amount: plate.amount,
    labelAmount,
    carbs: (product.carbs_per_100 * labelAmount) / 100,
    fat: per(product.fat_per_100),
    fiber: per(product.fiber_per_100),
    protein: per(product.protein_per_100),
    kcal: per(product.kcal_per_100),
  };
}

export function levelFor(carbs: number, s: Settings): Level {
  if (carbs > s.max_meal_carbs) return 'over';
  if (carbs > s.preferred_max) return 'near';
  return 'normal';
}

type Computable = Pick<Ingredient, 'product_id' | 'slot_category' | 'unit' | 'state' | 'role'> & { quantity: number };

export function computeMeal<T extends Computable>(
  ings: T[],
  products: Product[],
  settings: Settings,
): MealResult & { lines: (Line & { ing: T })[] } {
  const lines = ings.map((ing) => ({ ing, ...computeLine(ing, products, settings) })) as (Line & { ing: T })[];
  const total: Nutrition = { carbs: 0, fat: 0, fiber: 0, protein: 0, kcal: 0 };
  const byRole: Record<Role, number> = { main: 0, drink: 0, snack: 0 };
  let nutritionPartial = false;
  for (const l of lines) {
    if (l.carbs === null) continue;
    total.carbs += l.carbs;
    byRole[l.ing.role] += l.carbs;
    for (const k of ['fat', 'fiber', 'protein', 'kcal'] as const) {
      if (l[k] === null) nutritionPartial = true;
      else total[k] += l[k] as number;
    }
  }
  const complete = lines.length > 0 && lines.every((l) => l.carbs !== null);
  return { lines, complete, total, nutritionPartial, byRole, level: levelFor(total.carbs, settings) };
}

export function computeSnack(s: Snack, products: Product[], settings: Settings) {
  return computeMeal([{ ...s, role: 'snack' as Role }], products, settings);
}

export const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : String(round1(n));

// ── product label helpers ───────────────────────────────────────────────────

/** Fill in whichever of per-100 / per-serving the label left out. */
export function deriveLabel(v: { per100?: number | null; serving?: number | null; perServing?: number | null }) {
  let { per100, serving, perServing } = v;
  per100 = per100 ?? null;
  serving = serving ?? null;
  perServing = perServing ?? null;
  if (per100 === null && serving && perServing !== null) per100 = round1((perServing / serving) * 100);
  if (perServing === null && serving && per100 !== null) perServing = round1((per100 * serving) / 100);
  return { per100, serving, perServing };
}

/** Both numbers were typed but disagree by more than rounding: probably a typo. */
export function labelMismatch(per100: number | null, serving: number | null, perServing: number | null): number | null {
  if (per100 === null || !serving || perServing === null) return null;
  const expected = (per100 * serving) / 100;
  return Math.abs(expected - perServing) > Math.max(1, perServing * 0.15) ? round1(expected) : null;
}

/** The category target a product misses, if any (editable in settings). */
export function targetMiss(p: Pick<Product, 'category' | 'carbs_per_100' | 'serving_size' | 'carbs_per_serving'>, s: Settings) {
  for (const t of s.category_targets) {
    if (t.category !== p.category) continue;
    if (t.basis === 'per100' && p.carbs_per_100 > t.max) return { ...t, actual: p.carbs_per_100 };
    if (t.basis === 'serving') {
      const actual = p.carbs_per_serving ?? (p.serving_size ? (p.carbs_per_100 * p.serving_size) / 100 : null);
      if (actual !== null && actual > t.max) return { ...t, actual: round1(actual) };
    }
  }
  return null;
}

export const PROBLEM_TEXT: Record<Problem, string> = {
  no_product: 'هذا المنتج غير مسجل. أدخل معلومات الملصق الغذائي أولًا.',
  unapproved: 'المنتج موجود لكنه غير معتمد. راجع الملصق ثم اعتمده.',
  no_serving: 'أدخل وزن الحصة للمنتج حتى تُحسب الكمية بالحبة.',
  no_yield: 'أدخل معامل الطبخ للمنتج (كم غرام مطبوخ من كل 1غ في العبوة) حتى يُحسب الوزن بعد الطبخ.',
  unit_mismatch: 'وحدة الكمية (غرام/مل) لا تطابق وحدة المنتج.',
};

export const STATE_TEXT: Record<State, string> = { raw: 'قبل الطبخ', cooked: 'بعد الطبخ', as_is: 'كما في العبوة' };
export const UNIT_TEXT: Record<Unit, string> = { g: 'غ', ml: 'مل', serving: 'حبة/حصة', tbsp: 'ملعقة كبيرة' };
