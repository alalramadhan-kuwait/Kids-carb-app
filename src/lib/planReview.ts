// A plan's review on screen: her readings around the meal, everything else that happened then (from the log), and
// engine/planReview.ts's answer. The latest answer is kept on the plan (review), so history, patterns and the
// care-team report can read it without the readings.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useData } from './data';
import { effectiveRange } from './glucose';
import { planMeal, saveReviewSnapshot } from './plans';
import { isFatty } from '../engine/iob';
import { isFastDrink } from '../engine/mealPlan';
import { reviewPlan, rulesOf, snapshotOf, type Other, type Review } from '../engine/planReview';
import { emptySeries, type Series } from '../engine/series';
import { windowSeries } from '../engine/meals';
import { tMaybe } from '../i18n';
import type { PlannedMeal } from './types';

const MIN = 60000;
/** When she started eating: recorded, or (older plans) when "She ate" was tapped. */
export const eatingOf = (p: PlannedMeal) => (p.eating_at ? Date.parse(p.eating_at) : p.eaten_at ? Date.parse(p.eaten_at) : null);

export function usePlanReview(plan: PlannedMeal | null) {
  const { history, events, products, settings } = useData();
  const [series, setSeries] = useState<Series | null>(null);
  const [now, setNow] = useState(Date.now());
  const eating = plan ? eatingOf(plan) : null;
  const dia = settings.iob_dia_min ?? 360;
  const final = plan?.review && (plan.review as { stage?: string }).stage === 'final';

  useEffect(() => {
    if (eating === null) { setSeries(null); return; }
    let stop = false;
    const load = () => {
      setNow(Date.now());
      supabase.rpc('glucose_windows', { p_times: [new Date(eating).toISOString()], p_before: 90, p_after: dia + 15 }).then(({ data }) => {
        if (stop) return;
        const w = (data as { o: number[]; v: number[] }[] | null)?.[0];
        setSeries(w ? windowSeries(eating, w.o.map(Number), w.v) : emptySeries());
      });
    };
    load();
    const id = final ? 0 : window.setInterval(load, 5 * MIN); // still running: refresh every few minutes
    return () => { stop = true; if (id) window.clearInterval(id); };
  }, [eating, dia, final]);

  const review: Review | null = useMemo(() => {
    if (!plan || eating === null || !series) return null;
    const own = new Set([plan.history_id, plan.dose_event_id, plan.treatment_event_id].filter(Boolean) as string[]);
    const from = eating - 90 * MIN, to = eating + (dia + 15) * MIN;
    const inWin = (iso: string) => { const t = Date.parse(iso); return t >= from && t <= to; };
    const others: Other[] = [
      ...history.filter((h) => !own.has(h.id) && inWin(h.eaten_at)).map((h) => ({ t: Date.parse(h.eaten_at), kind: 'food' as const, label: tMaybe(h.name), grams: h.total_carbs })),
      ...events.filter((e) => !e.deleted_at && !own.has(e.id) && inWin(e.occurred_at)).flatMap((e): Other[] => {
        const t = Date.parse(e.occurred_at);
        if (e.kind === 'carbs') return [{ t, kind: 'carbs', label: tMaybe(e.note ?? ''), grams: e.carbs_g }];
        if (e.kind === 'treatment') return [{ t, kind: 'treatment', label: tMaybe(e.treatment ?? ''), grams: e.carbs_g }];
        // any other rapid dose after the meal changes its curve: counted as a correction
        if (e.kind === 'insulin' && e.insulin_type !== 'long' && t > eating) return [{ t, kind: 'correction', label: '', units: e.insulin_units }];
        if (e.kind === 'exercise') return [{ t, kind: 'exercise', label: tMaybe(e.note ?? '') }];
        return [];
      }),
    ];
    const meal = planMeal(plan.items, products, settings);
    const carbs = meal.total.carbs || 1;
    const fast = meal.lines.reduce((s, l) => s + (isFastDrink(l.ing, l.product?.category, l.carbs) ? l.carbs ?? 0 : 0), 0);
    const estimated = meal.lines.filter((l) => !l.product || !l.product.approved).map((l, k) => tMaybe(l.ing.label ?? l.product?.name ?? plan.items[k]?.slot_category ?? ''));
    const range = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
    return reviewPlan({
      now, eatingAt: eating, dosedAt: plan.dosed_at ? Date.parse(plan.dosed_at) : null,
      calcUnits: plan.calc_units ?? null, givenUnits: plan.given_units ?? null,
      carbsPlanned: plan.carbs_planned ?? null, carbsEaten: plan.carbs_eaten ?? null, part: plan.part_eaten ?? null,
      startLevel: plan.dose_snapshot?.level ?? null, series, others,
      range: { low: range.low ?? 70, high: range.high ?? 180 }, diaMin: dia,
      fatty: isFatty(meal.missing.fat ? null : meal.total.fat, meal.missing.protein ? null : meal.total.protein),
      fastShare: fast / carbs, estimatedItems: estimated, eatingTimeEstimated: !plan.eating_at,
      rules: rulesOf(settings.plan_review_rules as never),
    });
  }, [plan, eating, series, history, events, products, settings, dia, now]);

  // keep the latest answer on the plan when it changes stage or result
  const saved = useRef('');
  useEffect(() => {
    if (!plan || !review || review.stage === 'waiting') return;
    const snap = snapshotOf(review);
    const key = JSON.stringify(snap);
    const old = JSON.stringify(plan.review ?? null);
    if (key === old || key === saved.current) return;
    saved.current = key;
    void saveReviewSnapshot(plan.id, snap as unknown as Record<string, unknown>).catch(() => { saved.current = ''; });
  }, [plan, review]);

  return { review, series, eating };
}
