// Planned meals: a meal prepared ahead with a dose time and an eat time, on hold until a parent approves the dose and
// confirms she ate. Pure, tested in Node. Nothing here decides a dose: the dose is the calculator's (the doctor's
// numbers, engine/dose.ts) and the parent approves or changes it. The alerts are short facts from her data.
import { isFatty } from './iob';
import type { DoseBlock } from './dose';

const MIN = 60000;
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type PlanStatus = 'planned' | 'dosed' | 'eaten' | 'skipped';
export interface PlanTimes { dose_at: string; eat_after_min: number; remind_min: number; status: PlanStatus; recheck_at: string | null }

export const eatAt = (p: PlanTimes) => Date.parse(p.dose_at) + p.eat_after_min * MIN;
export const remindAt = (p: PlanTimes) => Date.parse(p.dose_at) - p.remind_min * MIN;

/**
 * Where a plan stands: later (on hold, before its reminder), check (time to look at her glucose and approve), recheck
 * (a low was treated; wait until the recheck time), wait_to_eat (dose given, before the eat time), eat_now, done.
 */
export type Phase = 'later' | 'check' | 'recheck' | 'wait_to_eat' | 'eat_now' | 'done';
export function phase(p: PlanTimes, now: number): Phase {
  if (p.status === 'eaten' || p.status === 'skipped') return 'done';
  if (p.status === 'dosed') return now < eatAt(p) ? 'wait_to_eat' : 'eat_now';
  if (p.recheck_at && now < Date.parse(p.recheck_at)) return 'recheck';
  return now < remindAt(p) && !p.recheck_at ? 'later' : 'check';
}
/** Plans worth showing on Now: not done, and their dose time within the next 12 hours (or overdue by up to 3). */
export const upcoming = <T extends PlanTimes>(plans: T[], now: number) =>
  plans.filter((p) => phase(p, now) !== 'done' && Date.parse(p.dose_at) - now <= 12 * 60 * MIN && now - Date.parse(p.dose_at) <= 3 * 60 * MIN)
    .sort((a, b) => Date.parse(a.dose_at) - Date.parse(b.dose_at));

/** The dose the doctor's ratio gives for the planned carbs alone, rounded down to the pen: a preview for the evening.
 *  The real one is calculated at the check, with her glucose and the insulin still working then. */
export const expectedDose = (carbs: number, cr: number | null, step: number) => (cr && cr > 0 ? Math.floor(carbs / cr / step + 1e-9) * step : null);

export type AlertKey = 'treat_first' | 'no_reading' | 'gap' | 'fatty' | 'over_max' | 'fast_drink' | 'recent_low';
export interface PlanAlert { key: AlertKey; tone: 'red' | 'amber'; until?: number; at?: number }

/**
 * What to see before approving, worst first. From the calculator's block (low / falling → treat first; no reading or
 * sensor warm-up → finger-prick; dose gap still running) and from the meal and her recent hours.
 */
export function planAlerts(p: {
  block: DoseBlock | null; until?: number; carbs: number; fat: number | null; protein: number | null; maxCarbs: number;
  fastDrinkCarbs: number; lastLowAt: number | null; now: number;
}): PlanAlert[] {
  const out: PlanAlert[] = [];
  if (p.block === 'low' || p.block === 'falling') out.push({ key: 'treat_first', tone: 'red' });
  if (p.block === 'no_reading' || p.block === 'warmup') out.push({ key: 'no_reading', tone: 'red' });
  if (p.block === 'recent_dose') out.push({ key: 'gap', tone: 'amber', until: p.until });
  if (p.lastLowAt !== null && p.now - p.lastLowAt <= 12 * 60 * MIN) out.push({ key: 'recent_low', tone: 'amber', at: p.lastLowAt });
  if (p.fastDrinkCarbs >= 10) out.push({ key: 'fast_drink', tone: 'amber' });
  if (p.carbs > p.maxCarbs) out.push({ key: 'over_max', tone: 'amber' });
  if (isFatty(p.fat, p.protein)) out.push({ key: 'fatty', tone: 'amber' });
  return out;
}

/** A drink with sugar acts in 10–15 minutes, faster than rapid insulin: a juice or nectar among the items. */
export const isFastDrink = (item: { role: string; unit: string }, category: string | null | undefined, carbs: number | null) =>
  (carbs ?? 0) >= 10 && (item.role === 'drink' || item.unit === 'ml' || category === 'مشروبات'); // i18n-ok: data value
