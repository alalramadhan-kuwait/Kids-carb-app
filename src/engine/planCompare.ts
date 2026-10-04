// Planned meals side by side: which past meals can be compared with one another, what repeats across comparable
// meals, and the evidence a care team may want to look at. Pure, tested in Node. It counts and describes; it never
// proposes a dose, a ratio, a timing or a setting. Flags only say "worth a look with the care team".
import type { ReviewRules } from './planReview';

const MMOL = 18.016;

/** One finished plan, as kept on its row (the review snapshot plus the dose record). */
export interface PlanFacts {
  id: string; key: string; name: string; at: number;      // when she started eating
  carbs: number | null;                                   // eaten, else planned
  start: number | null;                                   // glucose when she started eating (mg/dL)
  level: number | null;                                   // the arrow at approval (−2 … +2)
  iob: number | null;
  calc: number | null; given: number | null; reason: string | null;
  cr: number | null; isf: number | null; correction: number | null;
  interval: number | null; part: number | null;
  outcome: 'in_target' | 'high' | 'low' | 'unclear' | null;
  quality: 'high' | 'limited' | null;
  comparable: boolean; notComparable: string[];
  peak: number | null; last: number | null; ttp: number | null; rise: number | null;
  lowAfterMin: number | null; lowMin: number | null; highMin: number | null;
  endedBy: string | null; cleanMin: number | null;
  contributors: string[];
  note: string | null;
}

const dirOf = (level: number | null) => (level === null ? null : level > 0 ? 1 : level < 0 ? -1 : 0);

/** Why meal `b` cannot be compared with meal `a` (empty: it can). Codes for the screen to word. */
export function whyNotLike(a: Pick<PlanFacts, 'carbs' | 'start' | 'level' | 'iob'>, b: PlanFacts, rules: ReviewRules): string[] {
  const c = rules.comparable, why: string[] = [];
  if (!b.comparable) why.push(...(b.notComparable.length ? b.notComparable : ['quality']));
  if (a.carbs !== null && b.carbs !== null && a.carbs > 0) {
    const pct = Math.round((Math.abs(b.carbs - a.carbs) / a.carbs) * 100);
    if (pct > c.carbs_pct) why.push(`carbs:${pct}`);
  } else if (a.carbs !== null || b.carbs !== null) why.push('carbs:?');
  if (a.start !== null && b.start !== null) {
    if (Math.abs(b.start - a.start) > c.start_mmol * MMOL) why.push(`start:${Math.round(Math.abs(b.start - a.start))}`);
  }
  const da = dirOf(a.level), db = dirOf(b.level);
  if (da !== null && db !== null && da !== db) why.push('direction');
  if (a.iob !== null && b.iob !== null && Math.abs(b.iob - a.iob) > c.iob_u) why.push(`iob:${Math.round(Math.abs(b.iob - a.iob) * 10) / 10}`);
  return why;
}

/** The last few times of the same meal, newest first, each with why it is not like this one. */
export function lastSimilar(key: string, now: Pick<PlanFacts, 'carbs' | 'start' | 'level' | 'iob'>, past: PlanFacts[], rules: ReviewRules, n = 3) {
  return past.filter((p) => p.key === key).sort((a, b) => b.at - a.at).slice(0, n).map((p) => ({ p, why: whyNotLike(now, p, rules) }));
}

export interface Group { key: string; name: string; meals: PlanFacts[]; comparable: PlanFacts[]; excluded: { p: PlanFacts; why: string[] }[] }

/** Each meal's comparable set: anchored on its newest comparable meal, the others like it. Fewer than pattern_min: no pattern. */
export function groupsOf(plans: PlanFacts[], rules: ReviewRules): Group[] {
  const by = new Map<string, PlanFacts[]>();
  for (const p of plans) by.set(p.key, [...(by.get(p.key) ?? []), p]);
  return [...by.entries()].map(([key, list]) => {
    const meals = [...list].sort((a, b) => b.at - a.at);
    const anchor = meals.find((p) => p.comparable) ?? null;
    const comparable: PlanFacts[] = [], excluded: Group['excluded'] = [];
    for (const p of meals) {
      const why = anchor ? (p === anchor ? [] : whyNotLike(anchor, p, rules)) : (p.notComparable.length ? p.notComparable : ['quality']);
      if (why.length) excluded.push({ p, why }); else comparable.push(p);
    }
    return { key, name: meals[0].name, meals, comparable, excluded };
  }).sort((a, b) => b.meals.length - a.meals.length);
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x));

export interface Pattern {
  n: number;
  outcomes: Record<'in_target' | 'high' | 'low' | 'unclear', number>;
  carbs: number | null; start: number | null; given: number | null; calc: number | null; interval: number | null;
  peak: number | null; ttp: number | null; last: number | null;
  repeats: { key: string; n: number; of: number; v?: number }[];
}

/** What comparable meals have in common. Only when there are at least pattern_min of them. */
export function patternOf(meals: PlanFacts[], rules: ReviewRules): Pattern | null {
  if (meals.length < rules.pattern_min) return null;
  const n = meals.length;
  const outcomes = { in_target: 0, high: 0, low: 0, unclear: 0 };
  for (const p of meals) if (p.outcome) outcomes[p.outcome]++;
  const repeats: Pattern['repeats'] = [];
  const add = (key: string, k: number, v?: number) => { if (k >= 2 && k * 3 >= n * 2) repeats.push({ key, n: k, of: n, ...(v !== undefined ? { v } : {}) }); };
  add('went_high', outcomes.high);
  add('went_low', outcomes.low);
  add('in_target', outcomes.in_target);
  const less = meals.filter((p) => p.calc !== null && p.given !== null && p.given - p.calc <= -0.5);
  const more = meals.filter((p) => p.calc !== null && p.given !== null && p.given - p.calc >= 0.5);
  add('gave_less', less.length, median(less.map((p) => p.given! - p.calc!)) ?? undefined);
  add('gave_more', more.length, median(more.map((p) => p.given! - p.calc!)) ?? undefined);
  add('early_rise', meals.filter((p) => p.contributors.includes('early_rise_interval')).length);
  add('late_rise', meals.filter((p) => p.contributors.includes('fatty_late')).length);
  add('late_low', meals.filter((p) => p.lowAfterMin !== null && p.lowAfterMin >= 180).length);
  return {
    n, outcomes,
    carbs: median(nums(meals.map((p) => p.carbs))), start: median(nums(meals.map((p) => p.start))),
    given: median(nums(meals.map((p) => p.given))), calc: median(nums(meals.map((p) => p.calc))),
    interval: median(nums(meals.map((p) => p.interval))), peak: median(nums(meals.map((p) => p.peak))),
    ttp: median(nums(meals.map((p) => p.ttp))), last: median(nums(meals.map((p) => p.last))), repeats,
  };
}

/** A setting the care team may want to look at, and the meals that point to it. Never a proposed value. */
export type SettingKey = 'icr' | 'isf' | 'target' | 'dia' | 'timing';
export interface Evidence { setting: SettingKey; finding: string; n: number; of: number; ids: string[] }

/**
 * Evidence across comparable meals (all meals, since the settings are shared):
 *  - meal ratio: the calculated dose was given and the meal still went high (or low) again and again
 *  - correction factor: a correction was part of the dose and she still ended high (or went low)
 *  - target: in range but repeatedly ending outside the target
 *  - insulin-action time: lows that start 3 hours or more after eating, after the calculated dose
 *  - dose-to-meal timing: an early rise after most meals
 */
export function evidenceOf(meals: PlanFacts[], rules: ReviewRules, target: [number, number] | null): Evidence[] {
  const out: Evidence[] = [];
  const min = rules.pattern_min;
  const push = (setting: SettingKey, finding: string, hit: PlanFacts[], of: PlanFacts[]) => {
    if (hit.length >= min && hit.length * 3 >= of.length * 2) out.push({ setting, finding, n: hit.length, of: of.length, ids: hit.map((p) => p.id) });
  };
  const asCalc = meals.filter((p) => p.calc !== null && p.given !== null && Math.abs(p.given - p.calc) < 0.5);
  push('icr', 'high_after_calc', asCalc.filter((p) => p.outcome === 'high' && !p.contributors.includes('early_rise_interval')), asCalc);
  push('icr', 'low_after_calc', asCalc.filter((p) => p.outcome === 'low' && !(p.lowAfterMin !== null && p.lowAfterMin >= 180)), asCalc);
  const corr = asCalc.filter((p) => (p.correction ?? 0) > 0);
  push('isf', 'high_after_correction', corr.filter((p) => p.outcome === 'high' || (p.last !== null && p.start !== null && p.last >= p.start)), corr);
  push('isf', 'low_after_correction', corr.filter((p) => p.outcome === 'low'), corr);
  if (target) {
    const inT = asCalc.filter((p) => p.outcome === 'in_target' && p.last !== null);
    push('target', 'end_above_target', inT.filter((p) => p.last! > target[1]), inT);
    push('target', 'end_below_target', inT.filter((p) => p.last! < target[0]), inT);
  }
  push('dia', 'late_low', asCalc.filter((p) => p.lowAfterMin !== null && p.lowAfterMin >= 180), asCalc);
  push('timing', 'early_rise', meals.filter((p) => p.contributors.includes('early_rise_interval')), meals.filter((p) => p.interval !== null));
  return out;
}
