// A finished plan as the comparison engine reads it: the review kept on the row plus the dose record.
import { useMemo } from 'react';
import { usePlanHistory } from './plans';
import { eatingOf } from './planReview';
import type { PlanFacts } from '../engine/planCompare';
import type { ReviewSnapshot } from '../engine/planReview';
import type { PlannedMeal } from './types';

/** The same meal: its recipe, else its name. */
export const planKey = (p: Pick<PlannedMeal, 'recipe_id' | 'name'>) => p.recipe_id ?? `name:${p.name.trim()}`;

/** Only plans whose final review is done (a running one is not compared yet). */
export function factsOf(p: PlannedMeal): PlanFacts | null {
  const r = p.review as ReviewSnapshot | null | undefined;
  const at = eatingOf(p);
  if (p.status !== 'eaten' || !r || r.stage !== 'final' || at === null) return null;
  const s = p.dose_snapshot ?? null;
  return {
    id: p.id, key: planKey(p), name: p.name, at,
    carbs: p.carbs_eaten ?? p.carbs_planned ?? null, start: r.at_eat ?? null, level: s?.level ?? null, iob: s?.iob ?? null,
    calc: p.calc_units ?? null, given: p.given_units ?? null, reason: p.dose_reason ?? null,
    cr: s?.cr ?? null, isf: s?.isf ?? null, correction: s?.correction ?? null,
    interval: r.interval ?? null, part: p.part_eaten ?? null,
    outcome: r.outcome ?? null, quality: r.quality ?? null, comparable: !!r.comparable, notComparable: r.not_comparable ?? [],
    peak: r.peak ?? null, last: r.last ?? null, ttp: r.ttp ?? null, rise: r.rise ?? null,
    lowAfterMin: r.low ? Math.round((Date.parse(r.low.at) - at) / 60000) : null, lowMin: r.low?.min ?? null, highMin: r.high?.minutes ?? null,
    endedBy: r.ended_by?.kind ?? null, cleanMin: r.clean_min ?? null,
    contributors: r.contributors ?? [], note: p.review_note ?? null,
  };
}

/** Every finished plan with a final review, newest first. */
export function usePlanFacts() {
  const { plans, loaded } = usePlanHistory();
  const facts = useMemo(() => plans.map(factsOf).filter((x): x is PlanFacts => x !== null).sort((a, b) => b.at - a.at), [plans]);
  return { facts, plans, loaded };
}
