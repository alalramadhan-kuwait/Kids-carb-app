// The review of one planned meal: what happened after the dose and the meal, judged on her own readings and her
// configured target range. Pure, tested in Node. It describes; it never proposes a dose, a ratio or a timing.
//
// Two stages: an early result about 2 hours after she started eating (an observation, not a judgement) and the final
// review over the configured insulin-action time. Anything else that moves glucose (more food, a hypo treatment, a
// correction) ends the meal's own window there; the meal is kept, and says where and why it ended.
import { nearest, type Series } from './series';

const MIN = 60000;

export interface ReviewRules {
  early_min: number;        // early result after this many minutes from the start of eating
  min_clean_min: number;    // a window shorter than this is "not clear" and not comparable
  small_food_g: number;     // food under this many grams of carbs does not end the window
  high_min: number;         // minutes above the target range that count as "went high"
  very_high_mgdl: number;   // or any reading at or above this
  very_low_mgdl: number;    // any reading at or below this is a low
  low_min: number;          // minutes below the target range that count as "went low"
  coverage_high: number;    // share of the window with readings for a "high" quality review
  early_rise_mgdl: number;  // a rise this big ...
  early_rise_min: number;   // ... within this many minutes of eating is an early rise
  late_rise_mgdl: number;   // a rise this big after 3 hours is a late rise
  comparable: { carbs_pct: number; start_mmol: number; iob_u: number; min_part: number };
  pattern_min: number;
}
export const DEFAULT_RULES: ReviewRules = {
  early_min: 120, min_clean_min: 120, small_food_g: 5, high_min: 30, very_high_mgdl: 250, very_low_mgdl: 54, low_min: 10,
  coverage_high: 0.9, early_rise_mgdl: 36, early_rise_min: 30, late_rise_mgdl: 30,
  comparable: { carbs_pct: 25, start_mmol: 2.0, iob_u: 0.5, min_part: 0.75 }, pattern_min: 3,
};
/** The stored rules over the defaults (a missing key keeps its default). */
export const rulesOf = (stored: Partial<ReviewRules> | null | undefined): ReviewRules =>
  ({ ...DEFAULT_RULES, ...(stored ?? {}), comparable: { ...DEFAULT_RULES.comparable, ...(stored?.comparable ?? {}) } });

/** Something else that moved glucose: food, carbs, a hypo treatment, a correction dose (these end the window), exercise. */
export interface Other { t: number; kind: 'food' | 'carbs' | 'treatment' | 'correction' | 'exercise'; label: string; grams?: number | null; units?: number | null }

export interface ReviewInput {
  now: number;
  eatingAt: number | null;
  dosedAt: number | null;
  calcUnits: number | null;
  givenUnits: number | null;
  carbsPlanned: number | null;
  carbsEaten: number | null;
  part: number | null;
  startLevel: number | null;      // the arrow at approval (−2 … +2)
  series: Series;                 // her readings around the meal (mg/dL)
  others: Other[];                // excluding this plan's own dose, treatment and meal
  range: { low: number; high: number };
  diaMin: number;                 // configured insulin-action time
  fatty: boolean;
  fastShare: number;              // share of the carbs from a sugary drink (0–1)
  estimatedItems: string[];       // items whose carbs are not from a label
  eatingTimeEstimated: boolean;
  rules: ReviewRules;
}

export type Outcome = 'in_target' | 'high' | 'low' | 'unclear';
export type Stage = 'waiting' | 'early' | 'final';
export type ContributorKey = 'early_rise_interval' | 'dose_lower' | 'dose_higher' | 'ate_less' | 'fast_carbs' | 'fatty_late' | 'carbs_estimated' | 'started_low' | 'started_high' | 'exercise';
export interface Contributor { key: ContributorKey; n?: number; m?: number; text?: string }

export interface Window {
  from: number; to: number;
  peak: number | null; ttp: number | null; rise: number | null;
  at2h: number | null; at3h: number | null; last: number | null; lastAt: number | null;
  direction: 'up' | 'flat' | 'down' | null;
  tir: number | null; min: number | null;
  low: { at: number; min: number } | null;
  high: { minutes: number; peak: number } | null;
  coverage: number;
}

export interface Review {
  stage: Stage;
  earlyAt: number | null; finalAt: number | null;
  end: number | null; endedBy: Other | null; cleanMin: number | null;
  atDose: number | null; atEat: number | null; interval: number | null; doseDiff: number | null;
  early: Window | null; final: Window | null;
  lateRise: boolean; returned: boolean | null;
  outcome: Outcome | null;
  quality: 'high' | 'limited'; qualityWhy: string[];
  comparable: boolean; notComparableWhy: string[];
  contributors: Contributor[];
  exercise: Other[];
}

/** Glucose at a moment: the nearest reading within 10 minutes. */
const at = (s: Series, t: number) => { const i = nearest(s, t, 10 * MIN); return i === null ? null : s.v[i]; };

/** Readings between two moments, each counting until the next (at most 15 minutes). */
function slices(s: Series, from: number, to: number) {
  const out: { t: number; v: number; dt: number }[] = [];
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i];
    if (t < from || t > to) continue;
    const next = i + 1 < s.t.length ? s.t[i + 1] : to;
    out.push({ t, v: s.v[i], dt: Math.max(0, Math.min(next, to, t + 15 * MIN) - t) });
  }
  return out;
}

/** The numbers for one window: from the start of eating (lows from the dose) to `to`. */
export function windowOf(s: Series, i: { eatingAt: number; dosedAt: number | null; to: number; range: { low: number; high: number }; rules: ReviewRules }): Window {
  const { eatingAt: e, to, range: r, rules } = i;
  const all = slices(s, Math.min(e, i.dosedAt ?? e), to), after = all.filter((x) => x.t >= e);
  const g0 = at(s, e);
  let peak: number | null = null, ttp: number | null = null;
  for (const x of after) if (peak === null || x.v > peak) { peak = x.v; ttp = Math.round((x.t - e) / MIN); }
  const covered = after.reduce((a, x) => a + x.dt, 0), span = Math.max(1, to - e);
  const inR = after.reduce((a, x) => a + (x.v >= r.low && x.v <= r.high ? x.dt : 0), 0);
  // a low: below the range for low_min minutes in a row, or one reading at or under very_low
  let low: Window['low'] = null, run = 0, runStart = 0;
  for (const x of all) {
    if (x.v < r.low) { if (!run) runStart = x.t; run += x.dt; } else run = 0;
    if (!low && (x.v <= rules.very_low_mgdl || run >= rules.low_min * MIN)) low = { at: x.v <= rules.very_low_mgdl ? x.t : runStart, min: x.v };
    if (low && x.v < low.min) low.min = x.v;
  }
  const above = after.reduce((a, x) => a + (x.v > r.high ? x.dt : 0), 0);
  const high = peak !== null && (above >= rules.high_min * MIN || peak >= rules.very_high_mgdl) ? { minutes: Math.round(above / MIN), peak } : null;
  const lastX = after.length ? after[after.length - 1] : null;
  // direction at the end: the last 15 minutes
  const tail = after.filter((x) => x.t >= to - 15 * MIN);
  const d = tail.length >= 2 ? (tail[tail.length - 1].v - tail[0].v) / Math.max(1, (tail[tail.length - 1].t - tail[0].t) / MIN) : null;
  return {
    from: e, to, peak, ttp, rise: peak !== null && g0 !== null ? peak - g0 : null,
    at2h: to >= e + 115 * MIN ? at(s, e + 120 * MIN) : null, at3h: to >= e + 175 * MIN ? at(s, e + 180 * MIN) : null,
    last: lastX?.v ?? null, lastAt: lastX?.t ?? null,
    direction: d === null ? null : d >= 1 ? 'up' : d <= -1 ? 'down' : 'flat',
    tir: covered ? Math.round((inR / covered) * 100) : null,
    min: after.length ? Math.min(...after.map((x) => x.v)) : null,
    low, high, coverage: Math.min(1, covered / span),
  };
}

export function reviewPlan(i: ReviewInput): Review {
  const R = i.rules, e = i.eatingAt;
  const base: Review = {
    stage: 'waiting', earlyAt: null, finalAt: null, end: null, endedBy: null, cleanMin: null,
    atDose: i.dosedAt !== null ? at(i.series, i.dosedAt) : null, atEat: e !== null ? at(i.series, e) : null,
    interval: e !== null && i.dosedAt !== null ? Math.round((e - i.dosedAt) / MIN) : null,
    doseDiff: i.calcUnits !== null && i.givenUnits !== null ? Math.round((i.givenUnits - i.calcUnits) * 100) / 100 : null,
    early: null, final: null, lateRise: false, returned: null, outcome: null,
    quality: 'high', qualityWhy: [], comparable: false, notComparableWhy: [], contributors: [], exercise: [],
  };
  if (e === null) return base;

  // the meal's own window: until the insulin-action time, or until something else moved glucose
  const fullEnd = e + i.diaMin * MIN;
  const enders = i.others.filter((o) => o.t > e && o.t < fullEnd && o.kind !== 'exercise' && !(o.kind === 'food' && (o.grams ?? 0) < R.small_food_g) && !(o.kind === 'carbs' && (o.grams ?? 0) < R.small_food_g))
    .sort((a, b) => a.t - b.t);
  const endedBy = enders[0] ?? null;
  const end = endedBy ? endedBy.t : fullEnd;
  const earlyAt = e + R.early_min * MIN;
  const exercise = i.others.filter((o) => o.kind === 'exercise' && o.t >= e - 60 * MIN && o.t <= end);
  const r: Review = { ...base, earlyAt, finalAt: end, end, endedBy, cleanMin: Math.round((end - e) / MIN), exercise };

  const win = (to: number) => windowOf(i.series, { eatingAt: e, dosedAt: i.dosedAt, to, range: i.range, rules: R });
  if (i.now >= Math.min(earlyAt, end)) { r.early = win(Math.min(earlyAt, end, i.now)); r.stage = 'early'; }
  if (i.now < end) return r;

  // final
  const f = win(end);
  r.final = f; r.stage = 'final';
  r.returned = f.last === null ? null : f.last >= i.range.low && f.last <= i.range.high;
  if (end - e >= 180 * MIN) {
    const late = slices(i.series, e + 120 * MIN, end);
    let lo = Infinity, rise = 0;
    for (const x of late) { lo = Math.min(lo, x.v); rise = Math.max(rise, x.v - lo); }
    r.lateRise = rise >= R.late_rise_mgdl && (f.direction === 'up' || (f.last !== null && f.last - lo >= R.late_rise_mgdl));
  }
  const clean = r.cleanMin! >= R.min_clean_min;
  r.outcome = f.low ? 'low' : !clean || f.coverage < 0.5 ? 'unclear' : f.high ? 'high' : 'in_target';

  // how far the data can be trusted
  if (f.coverage < R.coverage_high) r.qualityWhy.push(`readings:${Math.round((1 - f.coverage) * (end - e) / MIN)}`);
  for (const x of i.estimatedItems) r.qualityWhy.push(`estimated:${x}`);
  if (i.eatingTimeEstimated) r.qualityWhy.push('eating_time');
  if (i.givenUnits === null) r.qualityWhy.push('no_dose');
  if (r.atEat === null) r.qualityWhy.push('no_start');
  r.quality = r.qualityWhy.length ? 'limited' : 'high';

  // suitable for comparison with other meals
  if (!clean) r.notComparableWhy.push(`ended:${r.cleanMin}`);
  if (r.quality === 'limited') r.notComparableWhy.push('quality');
  if (i.part !== null && i.part < R.comparable.min_part) r.notComparableWhy.push(`part:${i.part}`);
  if (r.interval === null) r.notComparableWhy.push('no_interval');
  if (exercise.length) r.notComparableWhy.push('exercise');
  r.comparable = r.notComparableWhy.length === 0;

  // what may have contributed: only what her readings and the record show
  const c: Contributor[] = [];
  const g0 = r.atEat;
  if (g0 !== null) {
    const firstMax = Math.max(-Infinity, ...slices(i.series, e, e + R.early_rise_min * MIN).map((x) => x.v));
    const early = Number.isFinite(firstMax) ? firstMax - g0 : 0;
    if (early >= R.early_rise_mgdl) {
      c.push({ key: 'early_rise_interval', n: Math.round(early), m: r.interval ?? undefined });
      if (i.fastShare >= 0.3) c.push({ key: 'fast_carbs', n: Math.round(i.fastShare * 100) });
    }
    if (g0 < i.range.low) c.push({ key: 'started_low', n: g0 });
    else if (g0 > i.range.high) c.push({ key: 'started_high', n: g0 });
  }
  if (r.doseDiff !== null && r.doseDiff <= -0.5 && (r.outcome === 'high' || f.high)) c.push({ key: 'dose_lower', n: i.givenUnits!, m: i.calcUnits! });
  if (r.doseDiff !== null && r.doseDiff >= 0.5 && r.outcome === 'low') c.push({ key: 'dose_higher', n: i.givenUnits!, m: i.calcUnits! });
  if (i.part !== null && i.part < 1 && r.outcome === 'low') c.push({ key: 'ate_less', n: i.part });
  if (i.fatty && r.lateRise) c.push({ key: 'fatty_late' });
  if (i.estimatedItems.length) c.push({ key: 'carbs_estimated', text: i.estimatedItems.join(', ') });
  if (exercise.length) c.push({ key: 'exercise', text: exercise.map((x) => x.label).join(', ') });
  r.contributors = c;
  return r;
}

/** What is kept on the plan row: enough for history, patterns and the care-team report without the readings. */
export function snapshotOf(r: Review) {
  const f = r.final ?? r.early;
  return {
    stage: r.stage, outcome: r.outcome, quality: r.quality, comparable: r.comparable, not_comparable: r.notComparableWhy,
    at_dose: r.atDose, at_eat: r.atEat, interval: r.interval, dose_diff: r.doseDiff, clean_min: r.cleanMin,
    ended_by: r.endedBy ? { kind: r.endedBy.kind, label: r.endedBy.label, t: new Date(r.endedBy.t).toISOString() } : null,
    peak: f?.peak ?? null, ttp: f?.ttp ?? null, rise: f?.rise ?? null, at2h: f?.at2h ?? null, at3h: f?.at3h ?? null, last: f?.last ?? null,
    tir: f?.tir ?? null, low: f?.low ? { at: new Date(f.low.at).toISOString(), min: f.low.min } : null, high: f?.high ?? null,
    late_rise: r.lateRise, returned: r.returned, contributors: r.contributors.map((x) => x.key),
  };
}
export type ReviewSnapshot = ReturnType<typeof snapshotOf>;
