// A meal corrected after its dose: the dose it would have been, for review. Retrospective only: it never suggests an
// injection, never changes the dose that was given, and uses only the calculation inputs saved with that dose (the
// doctor's numbers, glucose and insulin on board at that moment), never today's settings. Without saved inputs there
// is no recalculation, and the screen says so instead of guessing.
import { supabase } from './supabase';
import type { HistoryEntry } from './types';

export { matchDose, recalcRow, reviewDose, type DoseLink, type Recalc } from '../engine/doseReview';
import { matchDose, recalcRow, type DoseLink, type EventLike, type PlanLike, type Recalc } from '../engine/doseReview';

async function loadLinkInputs(h: HistoryEntry & { client_id?: string | null }) {
  const t = Date.parse(h.eaten_at);
  const ors = [`history_id.eq.${h.id}`, ...(h.client_id ? [`id.eq.${h.client_id}`] : [])].join(',');
  const [prior, plans, events] = await Promise.all([
    supabase.from('dose_recalcs').select('*').eq('history_id', h.id).order('at', { ascending: false }).limit(1),
    supabase.from('planned_meals').select('id,history_id,dose_event_id,dose_snapshot').or(ors),
    supabase.from('events').select('id,kind,insulin_type,bolus_purpose,occurred_at,deleted_at,dose_calc,insulin_units').eq('kind', 'insulin')
      .gte('occurred_at', new Date(t - 45 * 60000).toISOString()).lte('occurred_at', new Date(t + 20 * 60000).toISOString()),
  ]);
  return { prior: (prior.data ?? []) as Recalc[], plans: (plans.data ?? []) as PlanLike[], events: (events.data ?? []) as (EventLike & { insulin_units: number | null })[] };
}

/** The dose this meal had, if one can be found for certain (for showing it, edited or not). */
export async function findDoseLink(h: HistoryEntry & { client_id?: string | null }): Promise<{ link: DoseLink; given: number | null } | null> {
  const x = await loadLinkInputs(h);
  const link = matchDose(h, x.prior, x.plans, x.events);
  if (!link) return null;
  let given: number | null = null;
  if (link.event_id) {
    const e = x.events.find((v) => v.id === link.event_id) ?? (await supabase.from('events').select('insulin_units,deleted_at').eq('id', link.event_id).maybeSingle()).data as { insulin_units: number | null; deleted_at: string | null } | null;
    given = e && !e.deleted_at && e.insulin_units != null ? Number(e.insulin_units) : null;
  }
  return { link, given };
}

/**
 * After a meal's carbs changed (items, typed carbs, or how much she ate): one review row is added. Nothing else
 * changes. Returns false when the meal has no dose with saved inputs (nothing to review) or nothing changed.
 * Never throws: the meal is already saved, and a missing review row must not look like a failed save.
 */
export async function recordRecalc(h: HistoryEntry & { client_id?: string | null }, carbsAfter: number, reason: 'items' | 'carbs' | 'part'): Promise<boolean> {
  try {
    if (Math.abs(carbsAfter - h.total_carbs) < 0.05) return false;
    // the same correction sent again (a retry after a lost answer): already recorded once
    const { data: last } = await supabase.from('dose_recalcs').select('carbs_after').eq('history_id', h.id).order('at', { ascending: false }).limit(1).maybeSingle();
    if (last && Math.abs(Number((last as { carbs_after: number }).carbs_after) - carbsAfter) < 0.05) return false;
    const found = await findDoseLink(h);
    if (!found) return false;
    const { error } = await supabase.from('dose_recalcs').insert(recalcRow(h, found.link, carbsAfter, found.given, reason));
    return !error;
  } catch { return false; }
}

/** Every review of this meal, oldest first. */
export async function recalcsOf(historyId: string): Promise<Recalc[]> {
  const { data } = await supabase.from('dose_recalcs').select('*').eq('history_id', historyId).order('at');
  return ((data ?? []) as Recalc[]).map((r) => ({ ...r, carbs_at_dose: r.carbs_at_dose == null ? null : Number(r.carbs_at_dose), dose_at_dose: r.dose_at_dose == null ? null : Number(r.dose_at_dose),
    carbs_before: Number(r.carbs_before), carbs_after: Number(r.carbs_after), dose_after: Number(r.dose_after), given_units: r.given_units == null ? null : Number(r.given_units) }));
}
