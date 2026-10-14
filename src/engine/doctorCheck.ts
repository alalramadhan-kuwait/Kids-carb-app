// "The doctor's numbers vs reality": how glucose actually went after a meal or a correction, compared with the curve
// the doctor's saved ratio and correction factor predicted when the dose was given (carb.predictions, frozen at the
// time). Pure, tested in Node.
//
// What it is and is not:
//  - an observation of outcomes, never a new ratio or correction factor, and never anything for the dose calculator;
//  - the 2-hour comparison is an EARLY outcome (insulin and food are still working); the 3–5 hour one is shown apart;
//  - a clean observation (nothing else known to move glucose) is never pooled with an affected one: insulin or food
//    still working from before, Tresiba moving glucose on its own, a fatty meal, or doubtful sensor data;
//  - a correction that fell more or less than predicted is not proof the correction factor is wrong.
import { isFatty } from './iob';
import { periodOf, SNACK_G } from './mealPeriod';
import { basalMarks, basalStretches, type Mark } from './basal';
import { PLAN_AFTER, predAt, readingNear, type Check, type CheckKey, type Entry } from './predict';
import type { Ratio } from './status';
import type { Series } from './series';

const MIN = 60000, H = 3600000, DAY = 86400000, KW = 3 * H;

/** Every threshold in one place, so the page and the visit report can print them. mg/dL unless named. */
export const DC = {
  near: 27,              // within ±1.5 mmol/L of the prediction counts as "near"
  minN: 5,               // fewer clean observations than this: "too few", no median shown
  modN: 10,              // at least this many (and a tight spread) for "moderate"; there is no "high"
  wideIqr: 54,           // middle half spread wider than 3 mmol/L: "low" whatever the count
  earlyMin: 120,         // the early outcome
  lateMin: 180, lateMax: 300, // the later outcome: at the end of the predicted curve, kept within 3–5 hours
  overlapIob: 0.3,       // units of an earlier dose still working at the start
  overlapCob: 5,         // grams of earlier food still being absorbed at the start
  driftMgH: 4.5,         // Tresiba: glucose moving ≥1 mmol/L per 4 h on its own (long-acting-only stretch)
  driftLookbackH: 18,    // …in a stretch of at least driftMinMin that ended within this many hours before
  driftMinMin: 120,
  biasMg: 18,            // finger-pricks around then disagree with the sensor by ≥1 mmol/L (median)
  biasDays: 3, biasMinN: 3,
  gapMin: 30,            // a hole in the sensor data this long inside the window
  lastDayH: 24,          // the last day of a sensor
} as const;

export type Group = 'breakfast' | 'lunch' | 'dinner' | 'correction';
export const GROUPS: Group[] = ['breakfast', 'lunch', 'dinner', 'correction'];
export type Flag = 'overlap' | 'tresiba' | 'fatty' | 'sensor';
export const FLAGS: Flag[] = ['overlap', 'tresiba', 'fatty', 'sensor'];
export type SensorWhy = 'day1' | 'last_day' | 'gaps' | 'bias';
export type Confidence = 'too_few' | 'low' | 'moderate';
export const WINDOWS = [7, 14, 30] as const;
export type Window = typeof WINDOWS[number];

export interface PredIn {
  key: string; t0: number; name: string | null; carbs: number; units: number; start_mg: number;
  params: { cr: number; isf: number; onboard_iob: number; onboard_cob: number };
  curve: number[]; end_min: number; checks: Partial<Record<CheckKey, Check>>; excluded: string | null;
}
export interface Outcome { min: number; pred: number; actual: number; diff: number } // diff = actual − predicted
export interface Obs {
  key: string; t0: number; group: Group; name: string | null; carbs: number; units: number; start: number; cr: number; isf: number;
  early: Outcome | null; late: Outcome | null;
  flags: Flag[]; sensorWhy: SensorWhy[]; clean: boolean;
}
export interface Stat { n: number; median: number | null; q1: number | null; q3: number | null; near: number; lower: number; higher: number }
export interface Part { clean: Stat; affected: Stat; conf: Confidence }
export interface GroupSummary {
  group: Group;
  win: Record<Window, { early: Part; late: Part }>;
  /** observations in the longest window, newest first */
  obs: Obs[];
  /** how many of those carry each flag (one observation can carry several) */
  flags: Record<Flag, number>;
}
/** The saved numbers in force when the predictions were made, as consecutive periods of one correction factor
 *  (with the carb ratios seen in it), oldest first: more than one period means observations were judged against
 *  different numbers. */
export interface SettingsSpan { isf: number; crs: number[]; first: number; last: number; n: number }
/** Predictions that no longer match the log (food or a dose added, edited or deleted after the prediction was saved). */
export interface Dropped { n: number; byGroup: Record<Group, number> }
/** Why a prediction is where it is in the ledger. Clean, one of the factors (affected), or why it cannot be compared. */
export type Reason = 'clean' | Flag | Mismatch | 'other_entry' | 'no_data' | 'pending';
/** Order in which an excluded prediction's primary reason is chosen: an invalid prediction first. */
export const EXCLUDED: Reason[] = ['deleted', 'edited', 'food_near', 'other_entry', 'no_data', 'pending'];
/** Every prediction of the period exactly once: its status, one primary reason, every reason that applies. */
export interface LedgerRow {
  key: string; t0: number; group: Group; name: string | null; carbs: number; units: number; start: number; cr: number; isf: number;
  status: 'clean' | 'affected' | 'excluded'; primary: Reason; reasons: Reason[]; sensorWhy: SensorWhy[];
  early: Outcome | null; late: Outcome | null;
}
export interface DoctorCheck { groups: GroupSummary[]; from: number; to: number; spans: SettingsSpan[]; dropped: Dropped; ledger: LedgerRow[] }

export interface Inputs {
  preds: PredIn[];
  entries: Entry[];                                   // engine/predict entriesFrom(history, events)
  makeup: Map<string, { fat: number | null; protein: number | null }>; // by entry key ('h:<id>')
  long: { t: number; units: number | null }[];        // long-acting doses
  series: Series;                                     // readings for the whole period and the day before
  comparisons: { t: number; diff: number | null; cause: string }[]; // finger-prick vs sensor (diff = libre − finger)
  sensor: { startedAt: number; days: number } | null; // the sensor known to the app (its last day is flagged)
  lowMg: number;
  now: number;
}

const kwMinute = (t: number) => Math.floor(((t + KW) % DAY) / MIN);

export function groupOf(p: Pick<PredIn, 't0' | 'carbs' | 'units'>): Group | null {
  if (p.units <= 0) return null;                      // food without insulin says nothing about the ratio
  if (p.carbs <= 0) return 'correction';
  if (p.carbs < SNACK_G) return null;
  const per = periodOf(kwMinute(p.t0), p.carbs);
  return per === 'snack' ? null : per;
}

export function stat(xs: number[]): Stat {
  const d = [...xs].sort((a, b) => a - b), n = d.length;
  const q = (f: number) => { if (!n) return null; const i = (n - 1) * f, lo = Math.floor(i), hi = Math.ceil(i); return d[lo] + (d[hi] - d[lo]) * (i - lo); };
  return { n, median: q(0.5), q1: q(0.25), q3: q(0.75), near: d.filter((x) => Math.abs(x) <= DC.near).length, lower: d.filter((x) => x < -DC.near).length, higher: d.filter((x) => x > DC.near).length };
}
export function confidence(s: Stat): Confidence {
  if (s.n < DC.minN) return 'too_few';
  if (s.n < DC.modN || (s.q3! - s.q1!) > DC.wideIqr) return 'low';
  return 'moderate';
}

/** The outcome at `min` minutes, or null if anything else was logged before then or there is no reading. */
function outcomeAt(p: PredIn, min: number, entries: Entry[], t: ArrayLike<number>, v: ArrayLike<number>): Outcome | null {
  const at = p.t0 + min * MIN;
  if (entries.some((e) => e.key !== p.key && e.t > p.t0 + PLAN_AFTER && e.t <= at)) return null;
  const actual = readingNear(t as number[], v as number[], at);
  if (actual === null) return null;
  const pred = Math.round(predAt(p.curve, min));
  return { min, pred, actual, diff: actual - pred };
}

/** The largest hole in the readings between two moments (minutes). */
function largestGap(t: ArrayLike<number>, from: number, to: number) {
  let prev = from, gap = 0;
  for (let i = 0; i < t.length; i++) { if (t[i] < from) continue; if (t[i] > to) break; gap = Math.max(gap, t[i] - prev); prev = t[i]; }
  return Math.max(gap, to - prev) / MIN;
}

function median(xs: number[]) { const d = [...xs].sort((a, b) => a - b), m = d.length >> 1; return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2; }

/** Why a frozen prediction no longer describes what the log says now, or null when it still does: its own entry was
 *  deleted; the carbs or insulin logged in its first 15 minutes were edited; or food was logged around what was saved as
 *  a correction (food around a dose makes it a meal dose, not a correction). */
export type Mismatch = 'deleted' | 'edited' | 'food_near';
export function mismatch(p: PredIn, entries: Entry[]): Mismatch | null {
  if (!entries.some((e) => e.key === p.key)) return 'deleted';
  // a minute's grace before: a stored time may be rounded (nothing is logged in the 15 minutes before a prediction's start)
  const inPlan = entries.filter((e) => e.t >= p.t0 - MIN && e.t <= p.t0 + PLAN_AFTER);
  const grams = inPlan.filter((e) => e.kind === 'meal' || e.kind === 'carbs' || e.kind === 'treatment').reduce((a, e) => a + e.grams, 0);
  const units = inPlan.filter((e) => e.kind === 'dose').reduce((a, e) => a + e.units, 0);
  if (p.carbs <= 0 && entries.some((e) => (e.kind === 'meal' || e.kind === 'carbs' || e.kind === 'treatment') && e.grams > 0 && e.t > p.t0 - 30 * MIN && e.t <= p.t0 + 60 * MIN)) return 'food_near';
  if (Math.abs(grams - p.carbs) > 2 || Math.abs(units - p.units) > 0.25) return 'edited';
  return null;
}
export const stillMatches = (p: PredIn, entries: Entry[]) => mismatch(p, entries) === null;

/** Everything known to move glucose besides the doctor's numbers, for one prediction (until `until`). */
function factorsOf(p: PredIn, group: Group, inp: Inputs, marks: Mark[], until: number) {
  const { t } = inp.series;
  const flags = new Set<Flag>(), why = new Set<SensorWhy>();
  if (p.params.onboard_iob >= DC.overlapIob || p.params.onboard_cob >= DC.overlapCob) flags.add('overlap');
  const mk = inp.makeup.get(p.key);
  if (group !== 'correction' && mk && isFatty(mk.fat, mk.protein)) flags.add('fatty');
  // Tresiba: a long-acting-only stretch shortly before in which glucose moved on its own
  const drift = basalStretches(inp.series, marks, inp.long, inp.lowMg, p.t0 - DC.driftLookbackH * H, p.t0)
    .some((x) => (x.to - x.from) / MIN >= DC.driftMinMin && Math.abs(x.rate) >= DC.driftMgH);
  if (drift) flags.add('tresiba');
  // the sensor: first day (already set when the prediction was made), its last day, holes, or finger-pricks disagreeing
  if (p.excluded === 'sensor_day1') why.add('day1');
  if (inp.sensor) {
    const end = inp.sensor.startedAt + inp.sensor.days * DAY;
    if (p.t0 >= inp.sensor.startedAt && p.t0 < end && end - p.t0 < DC.lastDayH * H) why.add('last_day');
  }
  if (largestGap(t, p.t0 - 10 * MIN, until) > DC.gapMin) why.add('gaps');
  const near = inp.comparisons.filter((x) => x.diff !== null && Math.abs(x.t - p.t0) <= DC.biasDays * DAY && (x.cause === 'agrees' || x.cause === 'sensor_bias')).map((x) => x.diff!);
  if (near.length >= DC.biasMinN && Math.abs(median(near)) >= DC.biasMg) why.add('bias');
  if (why.size) flags.add('sensor');
  return { flags, why };
}
const marksOf = basalMarks;

export function observe(inp: Inputs, dropped?: Obs['key'][]): Obs[] {
  const { t, v } = inp.series;
  const marks = marksOf(inp.entries);
  const out: Obs[] = [];
  for (const p of inp.preds) {
    const group = groupOf(p);
    if (!group) continue;
    const c = p.checks['120'];
    const early: Outcome | null = c && 'actual' in c ? { min: DC.earlyMin, pred: c.pred, actual: c.actual, diff: c.actual - c.pred } : null;
    const lateMin = Math.min(DC.lateMax, Math.max(DC.lateMin, p.end_min));
    const late = outcomeAt(p, lateMin, inp.entries, t, v);
    if (!early && !late) continue;
    if (!stillMatches(p, inp.entries)) { dropped?.push(p.key + '|' + group); continue; }

    const { flags, why } = factorsOf(p, group, inp, marks, p.t0 + (late?.min ?? early?.min ?? DC.earlyMin) * MIN);

    out.push({ key: p.key, t0: p.t0, group, name: p.name, carbs: p.carbs, units: p.units, start: p.start_mg, cr: p.params.cr, isf: p.params.isf,
      early, late, flags: FLAGS.filter((f) => flags.has(f)), sensorWhy: [...why], clean: flags.size === 0 });
  }
  return out.sort((a, b) => b.t0 - a.t0);
}

function part(list: Obs[], h: 'early' | 'late'): Part {
  const has = list.filter((o) => o[h]);
  const clean = stat(has.filter((o) => o.clean).map((o) => o[h]!.diff));
  return { clean, affected: stat(has.filter((o) => !o.clean).map((o) => o[h]!.diff)), conf: confidence(clean) };
}

function spansOf(preds: PredIn[], now: number): SettingsSpan[] {
  const out: SettingsSpan[] = [];
  for (const p of [...preds].filter((x) => x.t0 >= now - 30 * DAY).sort((a, b) => a.t0 - b.t0)) {
    const s = out[out.length - 1];
    if (s && s.isf === p.params.isf) { s.last = p.t0; s.n++; if (!s.crs.includes(p.params.cr)) s.crs.push(p.params.cr); }
    else out.push({ isf: p.params.isf, crs: [p.params.cr], first: p.t0, last: p.t0, n: 1 });
  }
  return out;
}

export function summarize(obs: Obs[], now: number, extra: { spans?: SettingsSpan[]; dropped?: string[] } = {}): DoctorCheck {
  const groups = GROUPS.map((group): GroupSummary => {
    const mine = obs.filter((o) => o.group === group);
    const win = {} as GroupSummary['win'];
    for (const w of WINDOWS) { const l = mine.filter((o) => o.t0 >= now - w * DAY); win[w] = { early: part(l, 'early'), late: part(l, 'late') }; }
    const last = mine.filter((o) => o.t0 >= now - 30 * DAY);
    const flags = Object.fromEntries(FLAGS.map((f) => [f, last.filter((o) => o.flags.includes(f)).length])) as Record<Flag, number>;
    return { group, win, obs: last, flags };
  });
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const d of extra.dropped ?? []) { const g = d.split('|')[1] as Group; if (g in byGroup) byGroup[g]++; }
  return { groups, from: now - 30 * DAY, to: now, spans: extra.spans ?? [], dropped: { n: extra.dropped?.length ?? 0, byGroup }, ledger: [] };
}

/** The ledger: each prediction of the last 30 days that tests the doctor's numbers (a meal with insulin, or a correction),
 *  once. Comparable at 2 hours and still matching the log: clean or affected (its first factor primary, all kept).
 *  Otherwise excluded, with the first reason in EXCLUDED as primary and the rest (and any factors) kept for its details. */
export function ledgerOf(inp: Inputs): LedgerRow[] {
  const marks = marksOf(inp.entries), { t, v } = inp.series, out: LedgerRow[] = [];
  for (const p of inp.preds) {
    const group = groupOf(p);
    if (!group || p.t0 < inp.now - 30 * DAY) continue;
    const bad = mismatch(p, inp.entries);
    const c = p.checks['120'];
    const early: Outcome | null = !bad && c && 'actual' in c ? { min: DC.earlyMin, pred: c.pred, actual: c.actual, diff: c.actual - c.pred } : null;
    const lateMin = Math.min(DC.lateMax, Math.max(DC.lateMin, p.end_min));
    const late = bad ? null : outcomeAt(p, lateMin, inp.entries, t, v);
    const { flags, why } = factorsOf(p, group, inp, marks, p.t0 + (late?.min ?? DC.earlyMin) * MIN);
    const f = FLAGS.filter((x) => flags.has(x));
    const no2h: Reason | null = c && 'actual' in c ? null : c && 'skip' in c ? c.skip : inp.now < p.t0 + (DC.earlyMin + 10) * MIN ? 'pending' : 'no_data';
    const excl = EXCLUDED.filter((r) => r === bad || r === no2h);
    const status: LedgerRow['status'] = excl.length || !early ? 'excluded' : f.length ? 'affected' : 'clean';
    const reasons: Reason[] = status === 'excluded' ? [...excl, ...f] : status === 'affected' ? f : ['clean'];
    out.push({ key: p.key, t0: p.t0, group, name: p.name, carbs: p.carbs, units: p.units, start: p.start_mg, cr: p.params.cr, isf: p.params.isf,
      status, primary: reasons[0], reasons, sensorWhy: [...why], early, late });
  }
  return out.sort((a, b) => b.t0 - a.t0);
}

export function doctorCheck(inp: Inputs): DoctorCheck {
  const dropped: string[] = [];
  const obs = observe(inp, dropped);
  return { ...summarize(obs, inp.now, { spans: spansOf(inp.preds, inp.now), dropped }), ledger: ledgerOf(inp) };
}

/** The values the family reported from the doctor, kept until the doctor confirms which are current. */
export const REPORTED = { cr: 15, isfMg: 72 } as const; // 1:15, 4.0 mmol/L per unit
export interface Discrepancy { cr: { from: string; cr: number }[]; isf: number[] }
/** Where the saved numbers differ from what was reported; null when they agree. */
export function discrepancy(ratios: Ratio[]): Discrepancy | null {
  const cr = ratios.filter((r) => r.cr !== REPORTED.cr).map((r) => ({ from: r.from, cr: r.cr }));
  const isf = [...new Set(ratios.map((r) => r.isf).filter((x) => Math.abs(x - REPORTED.isfMg) > 0.5))];
  return cr.length || isf.length ? { cr, isf } : null;
}
