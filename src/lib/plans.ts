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

export async function savePlan(p: Omit<PlannedMeal, 'id' | 'status' | 'dose_event_id' | 'treatment_event_id' | 'history_id' | 'recheck_at' | 'dosed_at' | 'eaten_at' | 'created_by'> & { id?: string; dosed?: boolean }) {
  // a meal edited after its dose keeps its reminders as they were (no second "time to eat")
  const row = { for_date: p.for_date, slot: p.slot, name: p.name, recipe_id: p.recipe_id, items: p.items, dose_at: p.dose_at, eat_after_min: p.eat_after_min, remind_min: p.remind_min, note: p.note, ...(p.dosed ? {} : { notified: {} }) };
  const { error } = p.id ? await supabase.from('planned_meals').update({ ...row, updated_at: new Date().toISOString() }).eq('id', p.id) : await supabase.from('planned_meals').insert(row);
  if (error) throw new Error(error.message);
  await load();
}
/** The dose was given at another time than logged: the dose entry and the plan move together (the meal follows). */
export async function setDoseTime(p: PlannedMeal, at: number, me: string | null) {
  const iso = new Date(at).toISOString();
  if (p.dose_event_id) {
    const { error } = await supabase.from('events').update({ occurred_at: iso, edited_by: me, edited_at: new Date().toISOString() }).eq('id', p.dose_event_id);
    if (error) throw new Error(error.message);
  }
  await patch(p.id, { dosed_at: iso, dose_at: iso });
}
/** More food after the dose: the extra dose is logged as a second meal dose; the plan adds it to what was given and
 *  calculated, and keeps the new carbs it now covers. */
export async function topUpDose(p: PlannedMeal, d: { given: number; calc: number; carbs: number }, clientId: string = uuid()) {
  const id = await saveEvent({
    client_id: clientId, kind: 'insulin', occurred_at: new Date().toISOString(), insulin_units: d.given, insulin_type: 'rapid', bolus_purpose: 'meal',
    carbs_g: null, treatment: null, note: 'إضافة للوجبة بعد تعديلها', /* i18n-ok: stored, shown with tMaybe */ activity_min: null, activity_level: null, ends_at: null, dose_calc: null, bg_mgdl: null,
  });
  if (!id) throw new Error('save');
  await patch(p.id, { given_units: (p.given_units ?? 0) + d.given, calc_units: (p.calc_units ?? 0) + d.calc, carbs_planned: Math.round(d.carbs * 10) / 10 });
}
export async function deletePlan(id: string) {
  const { error } = await supabase.from('planned_meals').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await load();
}
export const skipPlan = (id: string) => patch(id, { status: 'skipped' });

/** What recording a plan's dose came to: saved, or not saved because a dose is already there (shown to the parent,
 *  who decides; nothing is merged or dropped silently). */
export type DoseConflict = { id: string; units: number; at: string; by: string | null };
export type DoseResult = { status: 'ok'; event_id: string } | { status: 'already_dosed' | 'recent_dose'; event: DoseConflict } | { status: 'no_plan' };

/** The parent approved the dose: it is logged now with what the calculator showed. The plan keeps the calculated dose,
 *  the dose given, why they differ (if said) and everything the calculation used; the meal waits for its eat time.
 *  One step in the database (carb.record_plan_dose): the plan and the insulin entry change together. The same
 *  `clientId` sent again (a retry) saves once. A plan the other parent already dosed, or a rapid dose in the last
 *  15 minutes, comes back as a conflict; `separate` records it anyway as a second dose that was really given. */
export async function approveDose(p: Pick<PlannedMeal, 'id'>, d: { given: number; calc: number | null; reason: string | null; purpose: 'meal' | 'correction' | 'both'; snapshot: DoseSnapshot | null; carbs: number; site?: string | null },
  clientId: string, separate = false): Promise<DoseResult> {
  const { data, error } = await supabase.rpc('record_plan_dose', {
    p_plan: p.id, p_client: clientId, p_units: d.given, p_purpose: d.purpose, p_reason: d.reason?.trim() || null, p_snapshot: d.snapshot,
    p_calc: d.calc, p_carbs: Math.round(d.carbs * 10) / 10, p_site: d.site ?? null, p_separate: separate,
  });
  if (error) throw new Error(error.message);
  const r = data as DoseResult;
  if (r.status === 'already_dosed' || r.status === 'recent_dose') r.event.units = Number(r.event.units);
  reloadAll();
  return r;
}

/** The parent said the dose already recorded is this meal's: the plan takes it (nothing new is saved). If that dose
 *  already belongs to another plan (the other parent planned the same meal), this plan is set aside instead, so the
 *  meal is not logged twice. */
export async function adoptDose(planId: string, ev: DoseConflict): Promise<'linked' | 'other_plan'> {
  const { data, error } = await supabase.from('planned_meals').select('id').eq('dose_event_id', ev.id).neq('id', planId).limit(1);
  if (error) throw new Error(error.message);
  if (data?.length) { await patch(planId, { status: 'skipped' }); return 'other_plan'; }
  await patch(planId, { status: 'dosed', dose_event_id: ev.id, dosed_at: ev.at, dose_at: ev.at, given_units: ev.units });
  return 'linked';
}

/** A low before the meal: treated now (with one of the plan's items, e.g. its juice, or another treatment). The item
 *  leaves the plan; a recheck is due in `recheckMin` minutes. Nothing is dosed. */
export async function treatFromPlan(p: PlannedMeal, t: { grams: number; name: string; itemIndex?: number }, recheckMin = 15, clientId: string = uuid()) {
  const now = new Date();
  const id = await saveEvent({
    client_id: clientId, kind: 'treatment', occurred_at: now.toISOString(), carbs_g: Math.round(t.grams * 10) / 10, treatment: t.name,
    insulin_units: null, insulin_type: null, bolus_purpose: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: null, bg_mgdl: null,
  });
  const items = t.itemIndex === undefined ? p.items : p.items.filter((_, i) => i !== t.itemIndex);
  await patch(p.id, { items, treatment_event_id: id, recheck_at: new Date(now.getTime() + recheckMin * 60000).toISOString() });
}

/** She ate (all or a part): the meal is logged at the time she started eating, from the plan's items scaled to what
 *  she ate; the plan keeps the part, the carbs planned and eaten, and the start of eating for its review. */
export async function ate(p: PlannedMeal, part: number, eatingAt: number, products: Product[], settings: Settings) {
  // a second tap, or the other phone, must not log the same meal twice
  const { data: now } = await supabase.from('planned_meals').select('status').eq('id', p.id).maybeSingle();
  if ((now as { status?: string } | null)?.status === 'eaten') throw new Error('already_eaten');
  const items = p.items.map((i, k) => ({ ...i, id: String(k), qty_confirmed: true, note: null, sort: k, quantity: i.quantity * part }));
  const meal = computeMeal(items, products, settings);
  if (!meal.complete) throw new Error('incomplete');
  const full = planMeal(p.items, products, settings).total.carbs;
  // one meal per plan: the plan's id is the meal's client id, so a retry or the other phone cannot log it twice
  const r = await logMeal({ kind: p.slot === 'snack' ? 'snack' : 'meal', recipe_id: p.recipe_id, name: p.name, category: null, meal, modified: part !== 1 || !p.recipe_id, eatenAt: new Date(eatingAt).toISOString(), notes: p.note ?? undefined, client_id: p.id });  // the plan's note (a weighed plate, an item left out) stays with the meal
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

/** Mom mode: a meal planned and dosed now, in one go. Returns the new plan (then approveDose records the dose). */
/** `id` is chosen by the screen and kept across retries: sent twice, the plan is made once. */
export async function planNow(p: { id: string; name: string; slot: PlannedMeal['slot']; items: PlanItem[]; eat_after_min: number; note?: string | null }): Promise<PlannedMeal> {
  const now = new Date();
  const kw = new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const ins = await supabase.from('planned_meals').upsert({ id: p.id, for_date: kw, slot: p.slot, name: p.name, recipe_id: null, items: p.items, dose_at: now.toISOString(),
    eat_after_min: p.eat_after_min, remind_min: 0, note: p.note ?? null, notified: { check: now.toISOString() } }, { onConflict: 'id', ignoreDuplicates: true });
  if (ins.error) throw new Error(ins.error.message);
  const plan = await fetchPlan(p.id);
  if (!plan) throw new Error('save');
  await load();
  return plan;
}
/** She started eating (mom mode's «بدأت تاكل»): the start is kept; "how much she ate" comes later. */
export const startEating = (id: string, at = Date.now()) => patch(id, { eating_at: new Date(at).toISOString() });
/** Mom mode: the dose given was corrected afterwards. */
export const setGivenUnits = (id: string, units: number) => patch(id, { given_units: units });
