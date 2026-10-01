import { supabase } from './supabase';
import type { HistoryLine, Ingredient, Product, Recipe, Settings, Snack } from './types';
import type { MealResult } from './carbs';
import type { GlucoseState } from './glucose';

const ok = <T,>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export async function saveProduct(p: Partial<Product> & { name: string; category: string; carbs_per_100: number }): Promise<string> {
  const row = clean({ ...p, updated_at: new Date().toISOString() });
  const res = ok(await supabase.from('products').upsert(row).select('id').single());
  return (res as { id: string }).id;
}

export const deleteProduct = async (id: string) => ok(await supabase.from('products').delete().eq('id', id));

export const setAvailable = async (id: string, available: boolean) =>
  ok(await supabase.from('products').update({ available }).eq('id', id));

type IngDraft = Omit<Ingredient, 'id' | 'recipe_id'> & { id?: string };

/** Save a recipe and its ingredients; keep a snapshot so the earlier version is never lost. */
export async function saveRecipe(recipe: Partial<Recipe> & { name: string }, ings: IngDraft[], total: number | null): Promise<string> {
  const row = clean({ ...recipe, saved_total_carbs: total ?? recipe.saved_total_carbs ?? null, updated_at: new Date().toISOString() });
  const saved = ok(await supabase.from('recipes').upsert(row).select('id').single()) as { id: string };
  const oldIds = recipe.id
    ? (ok(await supabase.from('recipe_ingredients').select('id').eq('recipe_id', saved.id)) as { id: string }[]).map((x) => x.id)
    : [];
  const rows = ings.map((i, n) => ({
    recipe_id: saved.id, role: i.role, product_id: i.product_id, slot_category: i.slot_category, label: i.label,
    quantity: i.quantity, unit: i.unit, state: i.state, qty_confirmed: i.qty_confirmed, note: i.note, sort: n,
  }));
  if (rows.length) ok(await supabase.from('recipe_ingredients').insert(rows));
  if (oldIds.length) ok(await supabase.from('recipe_ingredients').delete().in('id', oldIds));
  ok(await supabase.from('recipe_versions').insert({ recipe_id: saved.id, total_carbs: total, snapshot: { recipe: row, ingredients: rows } }));
  return saved.id;
}

export const deleteRecipe = async (id: string) => ok(await supabase.from('recipes').delete().eq('id', id));
export const setFavorite = async (id: string, favorite: boolean) => ok(await supabase.from('recipes').update({ favorite }).eq('id', id));
export const setRecipeImage = async (id: string, image_path: string) =>
  ok(await supabase.from('recipes').update({ image_path }).eq('id', id));
export const acceptTotal = async (id: string, total: number) =>
  ok(await supabase.from('recipes').update({ saved_total_carbs: total }).eq('id', id));

export async function saveSnack(s: Partial<Snack> & { name: string; quantity: number }) {
  return ok(await supabase.from('snacks').upsert(clean(s)));
}
export const deleteSnack = async (id: string) => ok(await supabase.from('snacks').delete().eq('id', id));

export async function logMeal(input: {
  kind: 'meal' | 'snack';
  recipe_id: string | null;
  name: string;
  category: string | null;
  meal: MealResult;
  modified: boolean;
  notes?: string;
}) {
  const { meal } = input;
  const lines: HistoryLine[] = meal.lines.map((l) => ({
    name: l.ing.label ?? l.product?.name ?? l.ing.slot_category ?? '',
    product: l.product ? [l.product.name, l.product.brand].filter(Boolean).join(' — ') : null,
    quantity: l.ing.quantity, unit: l.ing.unit, state: l.ing.state, role: l.ing.role,
    carbs: l.carbs === null ? null : Math.round(l.carbs * 10) / 10,
  }));
  const r = (n: number) => Math.round(n * 10) / 10;
  // the glucose reading at the time, but only if it is recent: an old number next to a meal is misleading
  const { data: g } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1).maybeSingle();
  const fresh = g && Date.now() - new Date(g.taken_at).getTime() <= 15 * 60000;
  return ok(await supabase.from('meal_history').insert({
    glucose_mgdl: fresh ? g.mg_dl : null, glucose_trend: fresh ? g.trend : null, glucose_at: fresh ? g.taken_at : null,
    kind: input.kind, recipe_id: input.recipe_id, name: input.name, category: input.category,
    total_carbs: r(meal.total.carbs),
    total_fat: meal.nutritionPartial ? null : r(meal.total.fat),
    total_fiber: meal.nutritionPartial ? null : r(meal.total.fiber),
    total_protein: meal.nutritionPartial ? null : r(meal.total.protein),
    total_kcal: meal.nutritionPartial ? null : Math.round(meal.total.kcal),
    modified: input.modified, lines, notes: input.notes ?? null,
  }));
}

export const deleteHistory = async (id: string) => ok(await supabase.from('meal_history').delete().eq('id', id));

export async function saveSettings(s: Settings) {
  return ok(await supabase.from('settings').upsert({ id: true, ...s, updated_at: new Date().toISOString() }));
}

export async function addPlan(rows: { plan_date: string; recipe_id: string; people: number }[]) {
  return ok(await supabase.from('meal_plan').upsert(rows, { onConflict: 'plan_date,recipe_id' }));
}
export const deletePlan = async (ids: string[]) => ok(await supabase.from('meal_plan').delete().in('id', ids));

/** The carb-glucose edge function: save / read / clear / status. */
export async function callGlucose(body: Record<string, unknown>): Promise<GlucoseState> {
  const { data, error } = await supabase.functions.invoke('carb-glucose', { body });
  if (error && !data) throw new Error(error.message);
  return data as GlucoseState;
}
