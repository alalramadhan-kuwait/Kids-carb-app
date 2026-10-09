import { glucoseAt, glucoseCols } from './productLog';
import { supabase } from './supabase';
import type { EventRow, HistoryLine, Ingredient, MealSlot, Product, Recipe, Settings, Snack } from './types';
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
/** Links one recipe ingredient to a chosen product, or back to "any product of its category" (null). */
export const setIngredientProduct = async (id: string, productId: string | null) =>
  ok(await supabase.from('recipe_ingredients').update({ product_id: productId }).eq('id', id));

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
    quantity: i.quantity, unit: i.unit, state: i.state, qty_confirmed: i.qty_confirmed, note: i.note, sort: n, on_side: !!i.on_side,
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
  eatenAt?: string; // when she started eating, if not now
  /** the same submission sent again (a retry, the other phone) saves once: the first one's id comes back */
  client_id?: string;
  /** 'pending': saved with its dose; how much she ate comes later (never counted as eaten until then) */
  intake?: 'pending';
  meal_slot?: MealSlot | null;
}) {
  const { meal } = input;
  const lines: HistoryLine[] = meal.lines.map((l) => ({
    name: l.ing.label ?? l.product?.name ?? l.ing.slot_category ?? '',
    product: l.product ? [l.product.name, l.product.brand].filter(Boolean).join(' — ') : null,
    quantity: l.ing.quantity, unit: l.ing.unit, state: l.ing.state, role: l.ing.role,
    carbs: l.carbs === null ? null : Math.round(l.carbs * 10) / 10,
  }));
  const r = (n: number) => Math.round(n * 10) / 10;
  // the glucose reading when she started eating (within 10 minutes), not when it was saved
  const g = await glucoseAt(input.eatenAt ? Date.parse(input.eatenAt) : Date.now());
  const r0 = await supabase.from('meal_history').insert({
    ...(input.client_id ? { client_id: input.client_id } : {}),
    ...(input.intake ? { intake: input.intake } : {}), ...(input.meal_slot ? { meal_slot: input.meal_slot } : {}),
    ...glucoseCols(g),
    kind: input.kind, recipe_id: input.recipe_id, name: input.name, category: input.category,
    total_carbs: r(meal.total.carbs),
    // each one on its own: a missing calorie figure must not hide the fat (the fatty-meal notes read it)
    total_fat: meal.missing.fat ? null : r(meal.total.fat),
    total_fiber: meal.missing.fiber ? null : r(meal.total.fiber),
    total_protein: meal.missing.protein ? null : r(meal.total.protein),
    total_kcal: meal.missing.kcal ? null : Math.round(meal.total.kcal),
    // the other label nutrients: null unless every ingredient gave it (missing is never zero)
    total_sat_fat: meal.micro.sat_fat === null ? null : r(meal.micro.sat_fat), total_sugar_added: meal.micro.sugar_added === null ? null : r(meal.micro.sugar_added),
    total_sodium: meal.micro.sodium === null ? null : Math.round(meal.micro.sodium), total_calcium: meal.micro.calcium === null ? null : Math.round(meal.micro.calcium),
    total_iron: meal.micro.iron === null ? null : r(meal.micro.iron), total_potassium: meal.micro.potassium === null ? null : Math.round(meal.micro.potassium),
    total_vit_d: meal.micro.vit_d === null ? null : r(meal.micro.vit_d),
    modified: input.modified, lines, notes: input.notes ?? null, ...(input.eatenAt ? { eaten_at: input.eatenAt } : {}),
  }).select('id').single();
  if (r0.error?.code === '23505' && input.client_id) return await savedMeal(input.client_id);
  return ok(r0) as { id: string };
}
/** The columns a computed meal writes (lines and every total), to update a meal in place. */
export function mealColumns(meal: MealResult) {
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    lines: meal.lines.map((l) => ({
      name: l.ing.label ?? l.product?.name ?? l.ing.slot_category ?? '',
      product: l.product ? [l.product.name, l.product.brand].filter(Boolean).join(' — ') : null,
      quantity: l.ing.quantity, unit: l.ing.unit, state: l.ing.state, role: l.ing.role,
      carbs: l.carbs === null ? null : r(l.carbs),
    })) as HistoryLine[],
    total_carbs: r(meal.total.carbs),
    total_fat: meal.missing.fat ? null : r(meal.total.fat), total_fiber: meal.missing.fiber ? null : r(meal.total.fiber),
    total_protein: meal.missing.protein ? null : r(meal.total.protein), total_kcal: meal.missing.kcal ? null : Math.round(meal.total.kcal),
    total_sat_fat: meal.micro.sat_fat === null ? null : r(meal.micro.sat_fat), total_sugar_added: meal.micro.sugar_added === null ? null : r(meal.micro.sugar_added),
    total_sodium: meal.micro.sodium === null ? null : Math.round(meal.micro.sodium), total_calcium: meal.micro.calcium === null ? null : Math.round(meal.micro.calcium),
    total_iron: meal.micro.iron === null ? null : r(meal.micro.iron), total_potassium: meal.micro.potassium === null ? null : Math.round(meal.micro.potassium),
    total_vit_d: meal.micro.vit_d === null ? null : r(meal.micro.vit_d),
  };
}
/** The meal a submission already saved (by its client id). */
export async function savedMeal(clientId: string): Promise<{ id: string }> {
  const r = await supabase.from('meal_history').select('id').eq('client_id', clientId).single();
  return ok(r) as { id: string };
}

/** A meal is deleted the way an entry is: kept, marked, and can be brought back (the database records who). */
export const deleteHistory = async (id: string, by: string | null = null) =>
  ok(await supabase.from('meal_history').update({ deleted_at: new Date().toISOString(), deleted_by: by }).eq('id', id));
export const restoreHistory = async (id: string) =>
  ok(await supabase.from('meal_history').update({ deleted_at: null, deleted_by: null }).eq('id', id));

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

// ── events (insulin, carbs, treatment, note) ──────────────────────────────────
export type NewEvent = Pick<EventRow, 'client_id' | 'kind' | 'occurred_at' | 'insulin_units' | 'insulin_type' | 'bolus_purpose' | 'carbs_g' | 'treatment' | 'note' | 'activity_min' | 'activity_level' | 'ends_at' | 'dose_calc' | 'bg_mgdl'> & { injection_site?: EventRow['injection_site'] };

/** Returns the new id. The same submission sent again (a double tap, a retry after a weak connection: the same
 *  client_id) is saved once, and its id comes back. */
export async function saveEvent(e: NewEvent): Promise<string | null> {
  const r = await supabase.from('events').insert(e).select('id').single();
  if (r.error) {
    if (r.error.code === '23505') {
      const x = await supabase.from('events').select('id').eq('client_id', e.client_id).maybeSingle();
      return (x.data as { id: string } | null)?.id ?? null;
    }
    throw new Error(r.error.message);
  }
  return (r.data as { id: string }).id;
}
/** Insulin of this type given within `min` minutes of `at`, fresh from the database (not the phone's copy, which
 *  can be a minute behind the other parent's). */
export async function insulinNear(type: 'rapid' | 'long', at: number, min = 15): Promise<EventRow[]> {
  const r = await supabase.from('events').select('*').eq('kind', 'insulin').eq('insulin_type', type).is('deleted_at', null)
    .gte('occurred_at', new Date(at - min * 60000).toISOString()).lte('occurred_at', new Date(at + min * 60000).toISOString())
    .order('occurred_at', { ascending: false });
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((e: any) => ({ ...e, insulin_units: e.insulin_units === null ? null : Number(e.insulin_units), carbs_g: e.carbs_g === null ? null : Number(e.carbs_g) }));
}
export const deleteEvent = async (id: string, by: string | null) =>
  ok(await supabase.from('events').update({ deleted_at: new Date().toISOString(), deleted_by: by }).eq('id', id));
export const restoreEvent = async (id: string) =>
  ok(await supabase.from('events').update({ deleted_at: null, deleted_by: null }).eq('id', id));

export async function glucoseStats(from: Date, to: Date, low: number | null, high: number | null) {
  const r = await supabase.rpc('glucose_stats', { p_from: from.toISOString(), p_to: to.toISOString(), p_low: low, p_high: high });
  if (r.error) throw new Error(r.error.message);
  const row = (r.data as any[])?.[0];
  if (!row) return null;
  const n = (v: any) => (v === null || v === undefined ? null : Number(v));
  return {
    n: Number(row.n), coverage: n(row.coverage) ?? 0, covered_min: n(row.covered_min) ?? 0,
    pct_vlow: n(row.pct_vlow) ?? 0, pct_low: n(row.pct_low) ?? 0, pct_in: n(row.pct_in) ?? 0, pct_high: n(row.pct_high) ?? 0, pct_vhigh: n(row.pct_vhigh) ?? 0,
    pct_target: n(row.pct_target), mean: n(row.mean_mgdl), sd: n(row.sd_mgdl), min: n(row.min_mgdl), max: n(row.max_mgdl),
  };
}
export type GlucoseStats = NonNullable<Awaited<ReturnType<typeof glucoseStats>>>;

/** Where an injection was given (rotation). */
export const setInjectionSite = async (id: string, site: NonNullable<EventRow['injection_site']>) =>
  ok(await supabase.from('events').update({ injection_site: site }).eq('id', id));
/** Mom mode: a dose's units corrected (who and when are kept). */
export const setEventUnits = async (id: string, units: number, by: string | null) =>
  ok(await supabase.from('events').update({ insulin_units: units, edited_by: by, edited_at: new Date().toISOString() }).eq('id', id));
