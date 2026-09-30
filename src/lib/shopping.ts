import { computeMeal } from './carbs';
import type { Ingredient, PlanRow, Product, Recipe, Settings } from './types';

export interface ShoppingItem {
  key: string;
  name: string;
  brand: string | null;
  category: string;
  unit: 'g' | 'ml';
  /** what to buy, as sold (cooked weights are converted back when the product has a yield) */
  qty: number;
  /** the plated weight, when it differs from qty (cooked rice / pasta) */
  plated: number | null;
  available: boolean;
  natural: boolean;
  /** whole packs needed, when the pack size is known */
  packs: number | null;
  /** true when no registered product could be found for the ingredient */
  unresolved: boolean;
}

/** Add up every ingredient of every planned meal, multiplied by the people eating. */
export function shoppingList(
  plan: PlanRow[],
  recipes: Recipe[],
  ingsByRecipe: Map<string, Ingredient[]>,
  products: Product[],
  settings: Settings,
): ShoppingItem[] {
  const items = new Map<string, ShoppingItem>();
  for (const row of plan) {
    if (!recipes.some((r) => r.id === row.recipe_id)) continue;
    const meal = computeMeal(ingsByRecipe.get(row.recipe_id) ?? [], products, settings);
    for (const l of meal.lines) {
      const label = l.ing.label ?? l.ing.slot_category ?? '؟';
      if (!l.product || l.amount === null || l.labelAmount === null) {
        const key = `?|${label}`;
        const cur = items.get(key) ?? {
          key, name: label, brand: null, category: l.ing.slot_category ?? 'أخرى', unit: 'g' as const,
          qty: 0, plated: null, available: false, natural: false, packs: null, unresolved: true,
        };
        items.set(key, cur);
        continue;
      }
      const p = l.product;
      const cur = items.get(p.id) ?? {
        key: p.id, name: p.name, brand: p.brand, category: p.category, unit: p.unit,
        qty: 0, plated: null, available: p.available, natural: p.kind === 'natural', packs: null, unresolved: false,
      };
      cur.qty += l.labelAmount * row.people;
      if (Math.abs(l.labelAmount - l.amount) > 0.01) cur.plated = (cur.plated ?? 0) + l.amount * row.people;
      items.set(p.id, cur);
    }
  }
  for (const it of items.values()) {
    const p = products.find((x) => x.id === it.key);
    if (p?.pack_size && it.qty > 0) it.packs = Math.ceil(it.qty / p.pack_size - 1e-9);
  }
  return [...items.values()].sort((a, b) => a.category.localeCompare(b.category, 'ar') || a.name.localeCompare(b.name, 'ar'));
}
