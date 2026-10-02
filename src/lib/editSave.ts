// Saving an edited entry (who and when are recorded). The checks are in edit.ts.
import { supabase } from './supabase';
import type { EditDraft } from './edit';
import { quickFromMeal } from './quick';
import { normBrand } from './brand';
import type { EventRow, HistoryEntry } from './types';

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
  // a one-item meal keeps its line in step with the total; a mixed meal keeps its lines and is marked as changed
  if (h.lines?.length === 1) patch.lines = [{ ...h.lines[0], carbs: d.carbs }];
  const { error } = await supabase.from('meal_history').update(patch).eq('id', h.id);
  if (error) throw new Error(error.message);
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
