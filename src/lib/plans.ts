// Planned meals in the database, shared live between the parents' phones. A plan is on hold: only what it logs (the
// dose, a treatment, the meal) reaches the log, insulin and carbs on board, predictions and research.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { logMeal, saveEvent } from './api';
import { computeMeal } from './carbs';
import type { DoseSnapshot, PlanItem, PlannedMeal, Product, Settings } from './types';

let cache: PlannedMeal[] | null = null;
const subs = new Set<(l: PlannedMeal[]) => void>();
async function load() {
  const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase.from('planned_meals').select('*').gte('for_date', since).order('dose_at');
  cache = ((data ?? []) as PlannedMeal[]).map((p) => ({ ...p, items: (p.items ?? []).map((i) => ({ ...i, quantity: Number(i.quantity) })) }));
  subs.forEach((f) => f(cache!));
}
// finished plans (eaten or cancelled), newest first: the history and its reviews
let past: PlannedMeal[] | null = null;
const pastSubs = new Set<(l: PlannedMeal[]) => void>();
async function loadPast() {
  const { data } = await supabase.from('planned_meals').select('*').in('status', ['eaten', 'skipped']).order('dose_at', { ascending: false }).limit(300);
  past = ((data ?? []) as PlannedMeal[]).map((p) => ({ ...p, items: (p.items ?? []).map((i) => ({ ...i, quantity: Number(i.quantity) })) }));
  pastSubs.forEach((f) => f(past!));
}
const reloadAll = () => { void load(); if (pastSubs.size) void loadPast(); };
let channel: ReturnType<typeof supabase.channel> | null = null;
const listen = () => { if (!channel) channel = supabase.channel('planned_meals').on('postgres_changes', { event: '*', schema: 'carb', table: 'planned_meals' }, reloadAll).subscribe(); };
/** Completed and cancelled plans, live. */
export function usePlanHistory() {
  const [list, setList] = useState<PlannedMeal[] | null>(past);
  useEffect(() => { pastSubs.add(setList); void loadPast(); listen(); return () => { pastSubs.delete(setList); }; }, []);
  return { plans: list ?? [], loaded: list !== null };
}
/** One plan by id, from either list (or the database). */
export async function fetchPlan(id: string): Promise<PlannedMeal | null> {
  const { data } = await supabase.from('planned_meals').select('*').eq('id', id).maybeSingle();
  return data ? { ...(data as PlannedMeal), items: ((data as PlannedMeal).items ?? []).map((i) => ({ ...i, quantity: Number(i.quantity) })) } : null;
}
/** Plans from two days ago on, live: a plan approved on one phone shows as dosed on the other. */
export function usePlans() {
  const [list, setList] = useState<PlannedMeal[] | null>(cache);
  useEffect(() => {
    subs.add(setList);
    if (!cache) void load();
    listen();
    const id = window.setInterval(() => void load(), 60000);
    return () => { subs.delete(setList); window.clearInterval(id); };
  }, []);
  return { plans: list ?? [], loaded: list !== null, reload: useCallback(load, []) };
}

const uuid = () => crypto.randomUUID();
async function patch(id: string, p: Partial<PlannedMeal>) {
  const { error } = await supabase.from('planned_meals').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  reloadAll();
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

/** The parent approved the dose: it is logged now with what the calculator showed. The plan keeps the calculated dose,
 *  the dose given, why they differ (if said) and everything the calculation used; the meal waits for its eat time. */
export async function approveDose(p: PlannedMeal, d: { given: number; calc: number | null; reason: string | null; purpose: 'meal' | 'correction' | 'both'; snapshot: DoseSnapshot | null; carbs: number }) {
  const now = new Date();
  const id = await saveEvent({
    client_id: uuid(), kind: 'insulin', occurred_at: now.toISOString(), insulin_units: d.given, insulin_type: 'rapid', bolus_purpose: d.purpose,
    carbs_g: null, treatment: null, note: d.reason, activity_min: null, activity_level: null, ends_at: null, dose_calc: d.snapshot, bg_mgdl: null,
  });
  // the meal is eaten eat_after_min after the dose actually given, not after the planned time
  await patch(p.id, { status: 'dosed', dose_event_id: id, dosed_at: now.toISOString(), dose_at: now.toISOString(), recheck_at: null,
    calc_units: d.calc, given_units: d.given, dose_reason: d.reason?.trim() || null, dose_snapshot: d.snapshot, carbs_planned: Math.round(d.carbs * 10) / 10 });
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

/** She ate (all or a part): the meal is logged at the time she started eating, from the plan's items scaled to what
 *  she ate; the plan keeps the part, the carbs planned and eaten, and the start of eating for its review. */
export async function ate(p: PlannedMeal, part: number, eatingAt: number, products: Product[], settings: Settings) {
  const items = p.items.map((i, k) => ({ ...i, id: String(k), qty_confirmed: true, note: null, sort: k, quantity: i.quantity * part }));
  const meal = computeMeal(items, products, settings);
  if (!meal.complete) throw new Error('incomplete');
  const full = planMeal(p.items, products, settings).total.carbs;
  const r = await logMeal({ kind: p.slot === 'snack' ? 'snack' : 'meal', recipe_id: p.recipe_id, name: p.name, category: null, meal, modified: part !== 1 || !p.recipe_id, eatenAt: new Date(eatingAt).toISOString() });
  await patch(p.id, { status: 'eaten', history_id: r.id, eaten_at: new Date().toISOString(), eating_at: new Date(eatingAt).toISOString(), part_eaten: part,
    carbs_planned: p.carbs_planned ?? Math.round(full * 10) / 10, carbs_eaten: Math.round(meal.total.carbs * 10) / 10 });
}

/** The review as last computed (kept for history, patterns and reports), and the parent's note. */
export const saveReviewSnapshot = (id: string, review: Record<string, unknown>) => patch(id, { review });
export async function saveReviewNote(id: string, note: string, reviewed: boolean, me: string | null) {
  await patch(id, { review_note: note.trim() || null, ...(reviewed ? { reviewed_at: new Date().toISOString(), reviewed_by: me } : {}) });
}
export const savePlanNote = (id: string, note: string) => patch(id, { note: note.trim() || null });

/** The plan's meal as the calculator sees it now (fresh from the product labels). */
export const planMeal = (items: PlanItem[], products: Product[], settings: Settings) =>
  computeMeal(items.map((i, k) => ({ ...i, id: String(k), qty_confirmed: true, note: null, sort: k })), products, settings);
