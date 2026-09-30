import { computeMeal, type MealResult } from './carbs';
import type { HistoryEntry, Ingredient, Product, Recipe, Settings } from './types';

export interface Candidate {
  recipe: Recipe;
  ings: Ingredient[];
  meal: MealResult;
}

/** Why a recipe is not suggestable, or null if it is. */
export function blocker(c: Candidate, s: Settings): string | null {
  if (!c.recipe.approved) return 'تحت المراجعة';
  if (c.recipe.carb_pending) return 'الكارب غير مكتمل';
  if (!c.meal.complete) return 'ينقصها منتجات';
  if (c.meal.total.carbs > s.max_meal_carbs) return 'تتجاوز الحد';
  return null;
}

export function candidatesOf(recipes: Recipe[], ingsByRecipe: Map<string, Ingredient[]>, products: Product[], s: Settings): Candidate[] {
  return recipes.map((recipe) => {
    const ings = ingsByRecipe.get(recipe.id) ?? [];
    return { recipe, ings, meal: computeMeal(ings, products, s) };
  });
}

/** Stable pseudo-random number in [0,1) from a string, so a day's picks do not change on reload. */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const daysBetween = (a: Date, b: Date) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);

export interface SuggestInput {
  candidates: Candidate[];
  history: HistoryEntry[];
  settings: Settings;
  today: Date;
  /** changes the picks without changing the rules (the "another suggestion" button) */
  shuffle?: number;
  count?: number;
  /** recipe ids already chosen for the previous day(s) of a plan */
  avoid?: string[];
}

/**
 * Pick meals from approved, complete recipes that stay within the carb limit.
 * Prefers: favourites, what is in the pantry, the preferred carb range, meals not
 * eaten recently. Does not repeat yesterday's meal while there are alternatives.
 */
export function suggest(input: SuggestInput): Candidate[] {
  const { candidates, history, settings, today, shuffle = 0, count = 3, avoid = [] } = input;
  const eligible = candidates.filter((c) => blocker(c, settings) === null);

  const lastEaten = new Map<string, number>(); // recipe id -> days ago (smallest)
  for (const h of history) {
    if (!h.recipe_id || h.kind !== 'meal') continue;
    const ago = daysBetween(today, new Date(h.eaten_at));
    if (ago < 0) continue;
    lastEaten.set(h.recipe_id, Math.min(ago, lastEaten.get(h.recipe_id) ?? Infinity));
  }

  const score = (c: Candidate) => {
    let s = 0;
    if (c.recipe.favorite) s += 30;
    const commercial = c.meal.lines.filter((l) => l.product?.kind === 'commercial');
    const pantry = commercial.length ? commercial.filter((l) => l.product?.available).length / commercial.length : 1;
    s += pantry * 30;
    const t = c.meal.total.carbs;
    if (t >= settings.preferred_min && t <= settings.preferred_max) s += 20;
    else if (t <= settings.max_meal_carbs) s += 5;
    const ago = lastEaten.get(c.recipe.id);
    if (ago !== undefined) s -= Math.max(0, 7 - ago) * 2;
    s += hash01(`${dayKey(today)}|${shuffle}|${c.recipe.id}`) * 8;
    return s;
  };

  const yesterday = new Set([...avoid, ...[...lastEaten].filter(([, ago]) => ago <= 1).map(([id]) => id)]);
  const fresh = eligible.filter((c) => !yesterday.has(c.recipe.id));
  const repeats = eligible.filter((c) => yesterday.has(c.recipe.id));

  const picked: Candidate[] = [];
  // repeating is a last resort, only to fill the list
  for (const pool of [fresh, repeats]) {
    const remaining = [...pool];
    while (picked.length < count && remaining.length) {
      let best = 0;
      let bestScore = -Infinity;
      remaining.forEach((c, i) => {
        // spread across categories: three chicken dishes in a row is not a choice
        const sameCat = picked.filter((p) => p.recipe.category && p.recipe.category === c.recipe.category).length;
        const sc = score(c) - sameCat * 12;
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      picked.push(remaining.splice(best, 1)[0]);
    }
  }
  return picked;
}
