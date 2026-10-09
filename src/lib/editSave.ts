// Saving an edited entry (who and when are recorded). The checks are in edit.ts.
import { supabase } from './supabase';
import { scaleLines, type EditDraft } from './edit';
import { quickFromMeal } from './quick';
import { normBrand } from './brand';
import type { EventRow, HistoryEntry, HistoryLine } from './types';
import { totalsPatch, type Nut } from './mealItems';
import { recordRecalc } from './recalc';

export async function updateEvent(e: EventRow, d: EditDraft, me: string | null) {
  const patch: Record<string, unknown> = { occurred_at: new Date(d.t!).toISOString(), edited_by: me, edited_at: new Date().toISOString() };
  if (e.kind === 'insulin') patch.insulin_units = d.units;
  if (e.kind === 'carbs' || e.kind === 'treatment') patch.carbs_g = d.carbs;
  if (e.kind === 'bg_check') patch.bg_mgdl = Math.round(d.bg!);
  if (e.kind === 'exercise') patch.activity_min = d.minutes ?? null;
  if (d.note !== undefined) patch.note = d.note.trim() || null;
  // something with an end (sleep) moves as a whole, keeping its length
  if (e.ends_at) patch.ends_at = new Date(Date.parse(e.ends_at) + d.t! - Date.parse(e.occurred_at)).toISOString();
  const { error } = await supabase.from('events').update(patch).eq('id', e.id);
  if (error) throw new Error(error.message);
  // a finger-prick comparison is recomputed with the corrected value or time
  if (e.kind === 'bg_check') await supabase.from('bg_comparisons').update({ bg_mgdl: Math.round(d.bg!), taken_at: patch.occurred_at, complete: false }).eq('event_id', e.id);
}

export async function updateMeal(h: HistoryEntry, d: EditDraft, me: string | null) {
  const patch: Record<string, unknown> = {
    eaten_at: new Date(d.t!).toISOString(), total_carbs: d.carbs, name: d.name!.trim(), brand: normBrand(d.brand),
    total_fat: d.fat ?? null, total_protein: d.protein ?? null, total_fiber: d.fiber ?? null, total_kcal: d.kcal ?? null,
    modified: true, edited_by: me, edited_at: new Date().toISOString(),
  };
  if (d.note !== undefined) patch.notes = d.note.trim() || null;
  // a part portion (½, ¾…) scales every item with the total, against what was saved; otherwise a one-item meal keeps
  // its line in step with the total, and a mixed meal keeps its lines and is marked as changed
  const f = d.part && d.part !== 1 && h.total_carbs > 0 && d.carbs != null ? d.carbs / h.total_carbs : null;
  if (f !== null && h.lines?.length) patch.lines = scaleLines(h.lines, f);
  else if (h.lines?.length === 1) patch.lines = [{ ...h.lines[0], carbs: d.carbs }];
  // the other label nutrients follow a part portion; a hand-changed total makes them unknown (never wrong)
  for (const k of ['total_sat_fat', 'total_sugar_added', 'total_sodium', 'total_calcium', 'total_iron', 'total_potassium', 'total_vit_d'] as const) {
    const v = h[k];
    if (v == null) continue;
    if (f !== null) patch[k] = Math.round(v * f * 10) / 10;
    else if (d.carbs !== h.total_carbs) patch[k] = null;
  }
  const { error } = await supabase.from('meal_history').update(patch).eq('id', h.id);
  if (error) throw new Error(error.message);
  // the carbs changed after a dose: the dose recalculated for review (the dose given is not touched)
  if (d.carbs != null) await recordRecalc(h, d.carbs, f !== null ? 'part' : 'carbs');
  if (d.toQuick) await quickFromMeal(h.name, { name: d.name!.trim(), brand: d.brand ?? null, kind: h.kind === 'meal' ? 'meal' : 'snack', carbs: d.carbs!, fat: d.fat ?? null, protein: d.protein ?? null, kcal: d.kcal ?? null, fiber: d.fiber ?? null, at: patch.eaten_at as string, label: d.label ?? null });
}

/** A carbs-only entry given a name and nutrition becomes a food entry (meal or snack) at the same time; the old
 *  entry is removed only once the new one is saved, so nothing is lost if saving fails. */
export async function carbsToMeal(e: EventRow, d: EditDraft, me: string | null): Promise<string> {
  const at = d.t!, iso = new Date(at).toISOString(), name = d.name!.trim();
  const { data: near } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend')
    .gte('taken_at', new Date(at - 10 * 60000).toISOString()).lte('taken_at', new Date(at + 10 * 60000).toISOString());
  const g = ((near ?? []) as { taken_at: string; mg_dl: number; trend: number | null }[]).sort((a, b) => Math.abs(Date.parse(a.taken_at) - at) - Math.abs(Date.parse(b.taken_at) - at))[0];
  const kind = (d.carbs ?? 0) >= 25 ? 'meal' : 'snack';
  const { data, error } = await supabase.from('meal_history').insert({
    kind, recipe_id: null, name, category: null, brand: normBrand(d.brand), eaten_at: iso,
    total_carbs: d.carbs, total_fat: d.fat ?? null, total_fiber: d.fiber ?? null, total_protein: d.protein ?? null, total_kcal: d.kcal ?? null,
    modified: false, lines: [{ name, product: [name, normBrand(d.brand)].filter(Boolean).join(' — '), quantity: 1, unit: 'serving', state: 'as_is', role: 'main', carbs: d.carbs }],
    notes: d.note?.trim() || null, created_by: e.created_by ?? me, edited_by: me, edited_at: new Date().toISOString(),
    glucose_mgdl: g?.mg_dl ?? null, glucose_trend: g?.trend ?? null, glucose_at: g?.taken_at ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  const del = await supabase.from('events').update({ deleted_at: new Date().toISOString(), deleted_by: me }).eq('id', e.id);
  if (del.error) { await supabase.from('meal_history').delete().eq('id', (data as { id: string }).id); throw new Error(del.error.message); }
  if (d.toQuick) await quickFromMeal(name, { name, brand: d.brand ?? null, kind, carbs: d.carbs!, fat: d.fat ?? null, protein: d.protein ?? null, kcal: d.kcal ?? null, fiber: d.fiber ?? null, at: iso, label: d.label ?? null });
  return (data as { id: string }).id;
}

/** The items of a logged meal changed (amounts, removed or added): its lines and totals are replaced; the recipe is not touched. */
export async function updateMealItems(h: HistoryEntry, r: { lines: HistoryLine[]; carbs: number; totals: Record<Nut, number | null> }, me: string | null) {
  const { error } = await supabase.from('meal_history').update({
    lines: r.lines, total_carbs: r.carbs, ...totalsPatch(r.totals), modified: true, edited_by: me, edited_at: new Date().toISOString(),
  }).eq('id', h.id);
  if (error) throw new Error(error.message);
  await recordRecalc(h, r.carbs, 'items');
}

/** A meal logged as carbs only (no items): its carbs corrected. The other totals cannot follow a typed number, so
 *  they become unknown (never wrong); a part of it ("she ate half") scales them instead. */
export async function setMealCarbs(h: HistoryEntry, carbs: number, part: number | null, me: string | null) {
  const patch: Record<string, unknown> = { total_carbs: carbs, modified: true, edited_by: me, edited_at: new Date().toISOString() };
  for (const k of ['total_fat', 'total_fiber', 'total_protein', 'total_kcal', 'total_sat_fat', 'total_sugar_added', 'total_sodium', 'total_calcium', 'total_iron', 'total_potassium', 'total_vit_d'] as const) {
    const v = h[k];
    if (v != null) patch[k] = part !== null ? Math.round(v * part * 10) / 10 : null;
  }
  if (h.lines?.length === 1) patch.lines = [{ ...h.lines[0], carbs }];
  const { error } = await supabase.from('meal_history').update(patch).eq('id', h.id);
  if (error) throw new Error(error.message);
  await recordRecalc(h, carbs, part !== null ? 'part' : 'carbs');
}

/** Breakfast, lunch, dinner or snack: the meal's kind, set apart from its name (which stays). */
export async function setMealSlot(id: string, slot: HistoryEntry['meal_slot'], me: string | null) {
  const { error } = await supabase.from('meal_history').update({ meal_slot: slot, kind: slot === 'snack' ? 'snack' : 'meal', edited_by: me, edited_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}
