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
  if (d.toQuick) await quickFromMeal(h.name, { name: d.name!.trim(), brand: d.brand ?? null, kind: h.kind === 'meal' ? 'meal' : 'snack', carbs: d.carbs!, fat: d.fat ?? null, protein: d.protein ?? null, kcal: d.kcal ?? null, fiber: d.fiber ?? null, at: patch.eaten_at as string });
}
