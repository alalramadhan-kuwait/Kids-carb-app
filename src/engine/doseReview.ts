// The dose of a meal corrected after it was given, for review: pure parts (tested in Node). Retrospective only: the
// same arithmetic as the dose calculator with the inputs saved with that dose and only the carbs changed.
import { doseSteps } from './dose';
import type { DoseSnapshot, EventRow, HistoryEntry } from '../lib/types';

export interface DoseLink { plan_id: string | null; event_id: string | null; snapshot: DoseSnapshot }
export interface Recalc {
  id: string; at: string; by: string | null; history_id: string; plan_id: string | null; event_id: string | null;
  carbs_at_dose: number | null; dose_at_dose: number | null; carbs_before: number; carbs_after: number; dose_after: number;
  given_units: number | null; inputs: DoseSnapshot; reason: string | null;
}
export type PlanLike = { id: string; history_id: string | null; dose_event_id: string | null; dose_snapshot: DoseSnapshot | null };
export type EventLike = Pick<EventRow, 'id' | 'kind' | 'insulin_type' | 'bolus_purpose' | 'occurred_at' | 'deleted_at'> & { dose_calc?: DoseSnapshot | null };

const usable = (s: DoseSnapshot | null | undefined): s is DoseSnapshot =>
  !!s && [s.cr, s.isf, s.glucose, s.iob].every((x) => typeof x === 'number' && Number.isFinite(x)) && s.cr > 0 && s.isf > 0 && Array.isArray(s.target);

/** The same calculation as the dose calculator, with the inputs saved then and only the carbs changed. */
export function reviewDose(s: DoseSnapshot, carbs: number): number {
  return doseSteps({ carbs, cr: s.cr, glucose: s.glucose, isf: s.isf, target: s.target, iob: s.iob, pen_step: s.pen_step }).dose;
}

/**
 * Which recorded dose this meal's dose was, only when it is certain: an earlier review of this meal (it already found
 * it), the planned meal it came from, or a full-mode calculator dose for exactly these carbs given from 45 minutes
 * before to 20 minutes after she started eating. Pure.
 */
export function matchDose(h: Pick<HistoryEntry, 'id' | 'eaten_at' | 'total_carbs'> & { client_id?: string | null }, prior: Recalc[], plans: PlanLike[], events: EventLike[]): DoseLink | null {
  const last = prior.filter((r) => r.history_id === h.id).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (last && usable(last.inputs)) return { plan_id: last.plan_id, event_id: last.event_id, snapshot: last.inputs };
  const p = plans.find((x) => (x.history_id === h.id || x.id === h.client_id) && usable(x.dose_snapshot));
  if (p) return { plan_id: p.id, event_id: p.dose_event_id, snapshot: p.dose_snapshot! };
  const t = Date.parse(h.eaten_at);
  const e = events.filter((x) => !x.deleted_at && x.kind === 'insulin' && x.insulin_type !== 'long' && x.bolus_purpose !== 'correction' && usable(x.dose_calc)
    && Date.parse(x.occurred_at) >= t - 45 * 60000 && Date.parse(x.occurred_at) <= t + 20 * 60000 && h.total_carbs !== null && Math.abs(x.dose_calc!.carbs - h.total_carbs) <= 1);
  return e.length === 1 ? { plan_id: null, event_id: e[0].id, snapshot: e[0].dose_calc! } : null; // two candidates: not certain
}

/** What one review row says, from the saved inputs. Pure. */
export function recalcRow(h: Pick<HistoryEntry, 'id' | 'total_carbs'>, link: DoseLink, carbsAfter: number, given: number | null, reason: string) {
  const s = link.snapshot;
  return {
    history_id: h.id, plan_id: link.plan_id, event_id: link.event_id,
    carbs_at_dose: s.carbs ?? null, dose_at_dose: s.suggested ?? reviewDose(s, s.carbs),
    carbs_before: h.total_carbs, carbs_after: carbsAfter, dose_after: reviewDose(s, carbsAfter),
    given_units: given, inputs: s, reason,
  };
}

