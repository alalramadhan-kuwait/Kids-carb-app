// Saving quick actions on a logged entry. Each returns what is needed to undo it.
import { glucoseAt, glucoseCols } from './productLog';
import { supabase } from './supabase';
import type { EventRow, HistoryEntry, HistoryLine, MealSlot } from './types';
import { savedMeal } from './api';
import { totalsPatch, type Nut } from './mealItems';

/** The same food again, now (with the glucose now when the reading is fresh). Returns the new id. */
export async function mealAgain(h: HistoryEntry): Promise<string> {
  const { data: g } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1).maybeSingle();
  const fresh = g && Date.now() - Date.parse(g.taken_at) <= 15 * 60000;
  const { data, error } = await supabase.from('meal_history').insert({
    kind: h.kind, recipe_id: h.recipe_id, name: h.name, category: h.category, brand: h.brand ?? null,
    total_carbs: h.total_carbs, total_fat: h.total_fat, total_fiber: h.total_fiber, total_protein: h.total_protein, total_kcal: h.total_kcal,
    modified: h.modified, lines: h.lines, notes: null,
    glucose_mgdl: fresh ? g.mg_dl : null, glucose_trend: fresh ? g.trend : null, glucose_at: fresh ? g.taken_at : null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** A new meal built from a logged one: its items as edited, the same food name, its kind (breakfast, lunch…) and a
 *  time. The old entry is not touched. `clientId` is kept across retries, so it is saved once. Returns the new id. */
export async function mealFrom(h: HistoryEntry, r: { lines: HistoryLine[]; carbs: number; totals: Record<Nut, number | null> }, slot: MealSlot, at: number, clientId: string): Promise<string> {
  const changed = r.carbs !== h.total_carbs || JSON.stringify(r.lines) !== JSON.stringify(h.lines);
  const { data, error } = await supabase.from('meal_history').insert({
    client_id: clientId, kind: slot === 'snack' ? 'snack' : 'meal', meal_slot: slot, recipe_id: h.recipe_id, name: h.name, category: h.category, brand: h.brand ?? null,
    eaten_at: new Date(at).toISOString(), total_carbs: r.carbs, ...totalsPatch(r.totals),
    modified: h.modified || changed, lines: r.lines, notes: null, ...glucoseCols(await glucoseAt(at)),
  }).select('id').single();
  if (error?.code === '23505') return (await savedMeal(clientId)).id;
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** The same carbs, treatment, note or activity again, now. Returns the new id. */
export async function eventAgain(e: EventRow): Promise<string> {
  const { data, error } = await supabase.from('events').insert({
    client_id: crypto.randomUUID(), kind: e.kind, occurred_at: new Date().toISOString(),
    carbs_g: e.carbs_g, treatment: e.treatment, note: e.note, activity_min: e.activity_min ?? null, activity_level: e.activity_level ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** Moves an entry to another time (recorded as an edit). */
export async function setEntryTime(it: { e?: EventRow; h?: HistoryEntry }, at: number, me: string | null) {
  const iso = new Date(at).toISOString(), stamp = { edited_by: me, edited_at: new Date().toISOString() };
  // a moved meal takes the glucose reading of its new time
  const r = it.h ? await supabase.from('meal_history').update({ eaten_at: iso, ...stamp, ...glucoseCols(await glucoseAt(at)) }).eq('id', it.h.id)
    : await supabase.from('events').update({ occurred_at: iso, ...stamp, ...(it.e!.ends_at ? { ends_at: new Date(Date.parse(it.e!.ends_at) + at - Date.parse(it.e!.occurred_at)).toISOString() } : {}) }).eq('id', it.e!.id);
  if (r.error) throw new Error(r.error.message);
}

/** A meal given another name (breakfast, lunch…), recorded as an edit. */
export async function setMealName(id: string, name: string, me: string | null) {
  const r = await supabase.from('meal_history').update({ name: name.trim(), edited_by: me, edited_at: new Date().toISOString() }).eq('id', id);
  if (r.error) throw new Error(r.error.message);
}

export async function setEntryNote(it: { e?: EventRow; h?: HistoryEntry }, note: string, me: string | null) {
  const v = note.trim() || null, stamp = { edited_by: me, edited_at: new Date().toISOString() };
  const r = it.h ? await supabase.from('meal_history').update({ notes: v, ...stamp }).eq('id', it.h.id) : await supabase.from('events').update({ note: v, ...stamp }).eq('id', it.e!.id);
  if (r.error) throw new Error(r.error.message);
}
