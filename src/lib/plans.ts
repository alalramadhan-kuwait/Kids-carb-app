// Planned meals in the database, shared live between the parents' phones. A plan is on hold: only what it logs (the
// dose, a treatment, the meal) reaches the log, insulin and carbs on board, predictions and research.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { logMeal, saveEvent } from './api';
import { computeMeal } from './carbs';
import type { DoseCalc, PlanItem, PlannedMeal, Product, Settings } from './types';

let cache: PlannedMeal[] | null = null;
const subs = new Set<(l: PlannedMeal[]) => void>();
async function load() {
  const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase.from('planned_meals').select('*').gte('for_date', since).order('dose_at');
  cache = ((data ?? []) as PlannedMeal[]).map((p) => ({ ...p, items: (p.items ?? []).map((i) => ({ ...i, quantity: Number(i.quantity) })) }));
  subs.forEach((f) => f(cache!));
}
let channel: ReturnType<typeof supabase.channel> | null = null;
/** Plans from two days ago on, live: a plan approved on one phone shows as dosed on the other. */
export function usePlans() {
  const [list, setList] = useState<PlannedMeal[] | null>(cache);
  useEffect(() => {
    subs.add(setList);
    if (!cache) void load();
    if (!channel) channel = supabase.channel('planned_meals').on('postgres_changes', { event: '*', schema: 'carb', table: 'planned_meals' }, () => void load()).subscribe();
    const id = window.setInterval(() => void load(), 60000);
    return () => { subs.delete(setList); window.clearInterval(id); };
  }, []);
  return { plans: list ?? [], loaded: list !== null, reload: useCallback(load, []) };
}

const uuid = () => crypto.randomUUID();
async function patch(id: string, p: Partial<PlannedMeal>) {
  const { error } = await supabase.from('planned_meals').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  await load();
}

export async function savePlan(p: Omit<PlannedMeal, 'id' | 'status' | 'dose_event_id' | 'treatment_event_id' | 'history_id' | 'recheck_at' | 'dosed_at' | 'eaten_at' | 'created_by'> & { id?: string }) {
  const row = { for_date: p.for_date, slot: p.slot, name: p.name, recipe_id: p.recipe_id, items: p.items, dose_at: p.dose_at, eat_after_min: p.eat_after_min, remind_min: p.remind_min, note: p.note, notified: {} };
  const { error } = p.id ? await supabase.from('planned_meals').update({ ...row, updated_at: new Date().toISOString() }).eq('id', p.id) : await supabase.from('planned_meals').insert(row);
  if (error) throw new Error(error.message);
  await load();
}
export async function deletePlan(id: string) {
  const { error } = await supabase.from('planned_meals').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await load();
}
export const skipPlan = (id: string) => patch(id, { status: 'skipped' });

/** The parent approved the dose: it is logged now (with what the calculator showed); the meal waits for its eat time. */
export async function approveDose(p: PlannedMeal, units: number, purpose: 'meal' | 'correction' | 'both', calc: DoseCalc | null) {
  const now = new Date();
  const id = await saveEvent({
    client_id: uuid(), kind: 'insulin', occurred_at: now.toISOString(), insulin_units: units, insulin_type: 'rapid', bolus_purpose: purpose,
    carbs_g: null, treatment: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: calc, bg_mgdl: null,
  });
  // the meal is eaten eat_after_min after the dose actually given, not after the planned time
  await patch(p.id, { status: 'dosed', dose_event_id: id, dosed_at: now.toISOString(), dose_at: now.toISOString(), recheck_at: null });
}

/** A low before the meal: treated now (with one of the plan's items, e.g. its juice, or another treatment). The item
 *  leaves the plan; a recheck is due in `recheckMin` minutes. Nothing is dosed. */
export async function treatFromPlan(p: PlannedMeal, t: { grams: number; name: string; itemIndex?: number }, recheckMin = 15) {
  const now = new Date();
  const id = await saveEvent({
    client_id: uuid(), kind: 'treatment', occurred_at: now.toISOString(), carbs_g: Math.round(t.grams * 10) / 10, treatment: t.name,
    insulin_units: null, insulin_type: null, bolus_purpose: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: null, bg_mgdl: null,
  });
  const items = t.itemIndex === undefined ? p.items : p.items.filter((_, i) => i !== t.itemIndex);
  await patch(p.id, { items, treatment_event_id: id, recheck_at: new Date(now.getTime() + recheckMin * 60000).toISOString() });
}

/** She ate (all or a part): the meal is logged now from the plan's items, scaled to what she ate. */
export async function ate(p: PlannedMeal, part: number, products: Product[], settings: Settings) {
  const items = p.items.map((i, k) => ({ ...i, id: String(k), qty_confirmed: true, note: null, sort: k, quantity: i.quantity * part }));
  const meal = computeMeal(items, products, settings);
  if (!meal.complete) throw new Error('incomplete');
  const r = await logMeal({ kind: p.slot === 'snack' ? 'snack' : 'meal', recipe_id: p.recipe_id, name: p.name, category: null, meal, modified: part !== 1 || !p.recipe_id });
  await patch(p.id, { status: 'eaten', history_id: r.id, eaten_at: new Date().toISOString() });
}

/** The plan's meal as the calculator sees it now (fresh from the product labels). */
export const planMeal = (items: PlanItem[], products: Product[], settings: Settings) =>
  computeMeal(items.map((i, k) => ({ ...i, id: String(k), qty_confirmed: true, note: null, sort: k })), products, settings);
