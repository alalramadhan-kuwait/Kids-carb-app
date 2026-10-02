// The research lab: what the app runs on its own every 12 hours. Pure, tested in Node with synthetic data.
//
// 1. Unexplained movements: 30-minute changes that the logged carbs and insulin (doctor's ratios) do not explain,
//    each put into one of four causes from the data alone: model error, missing event, CGM/sensor, bad input.
//    Only a "missing event" can need a parent, and only the most informative few become questions.
// 2. Scoring: every model on the same moments, on data the Baseline v1 report never saw.
// 3. Candidates: tuned methods re-choose their settings each day from older data only (walk-forward), and are
//    judged on the day after. Poor ones are rejected automatically; one is brought to the parents only when it is
//    materially better than what the app shows. Nothing here changes a dose, a displayed reading or a rule.
import { iobFraction } from './iob';
import { minuteOnly } from './trend';
import { MODELS, contextModel, dampedTrend, samples, score, type Exclusion, type Predictor, type RContext, type RReading, type Sample, type Score, type Situation } from './research';

const MIN = 60000, HOUR = 3600000, DAY = 86400000, KW = 3 * HOUR;
export const LAB_CODE_VERSION = 1;

/* ------------------------------------------------------------------ models */

export type ModelRole = 'production' | 'reference' | 'candidate';
export interface ModelDef { key: string; version: number; name: string; note: string; role: ModelRole; params: Record<string, unknown> | null }
const FIT_W = [0, 0.25, 0.5, 0.75], FIT_ABSORB = [120, 180, 240], DAMP_K = [0.25, 0.5, 0.75, 1];
/** Every model the lab knows, with its version. A changed definition gets a new version; old ones stay in the history. */
export const REGISTRY: ModelDef[] = [
  { key: 'none', version: 1, name: 'No change', note: 'glucose stays where it is', role: 'reference', params: null },
  { key: 'libre', version: 1, name: 'Libre arrow', note: "the arrow's speed band carried forward (what the app shows)", role: 'production', params: null },
  { key: 'trend', version: 1, name: 'App trend', note: 'least-squares rate over 20 min carried forward', role: 'reference', params: null },
  { key: 'context', version: 1, name: 'Context v1', note: 'carbs + insulin with the doctor\'s ratios + half the unexplained trend; fixed, as in Baseline v1', role: 'candidate', params: { w: 0.5, absorb: 'settings' } },
  { key: 'context_fit', version: 1, name: 'Context, refit daily', note: 'Context with the trend share and absorption time chosen each day from older days only', role: 'candidate', params: { w: FIT_W, absorb: FIT_ABSORB } },
  { key: 'damped', version: 1, name: 'Damped trend', note: 'the app trend scaled down, the scale chosen each day from older days only', role: 'candidate', params: { k: DAMP_K } },
];
export const CANDIDATES = REGISTRY.filter((m) => m.role === 'candidate').map((m) => m.key);

/** The grid behind the refit candidates: key `family|…` → predictor. */
export function gridModels(): Record<string, { f: Predictor }> {
  const g: Record<string, { f: Predictor }> = {};
  for (const w of FIT_W) for (const a of FIT_ABSORB) g[`context_fit|${w}|${a}`] = { f: contextModel(w, a) };
  for (const k of DAMP_K) g[`damped|${k}`] = { f: dampedTrend(k) };
  return g;
}

export const kuwaitDay = (t: number) => Math.floor((t + KW) / DAY) * DAY - KW;

/**
 * Walk-forward: for each Kuwait day from `testFrom`, pick the family member with the lowest error on all earlier
 * moments (at least `minTrainDays` of them), and use it on that day only. Writes the choice as `preds[family]`.
 */
export function walkForward(rows: Sample[], family: string, testFrom: number, minTrainDays = 2): { day: number; key: string }[] {
  const keys = Object.keys(rows[0]?.preds ?? {}).filter((k) => k.startsWith(family + '|'));
  const choices: { day: number; key: string }[] = [];
  const days = [...new Set(rows.filter((r) => r.t >= testFrom).map((r) => kuwaitDay(r.t)))].sort((a, b) => a - b);
  for (const day of days) {
    const train = rows.filter((r) => r.t < Math.max(day, testFrom) && r.t < day);
    if (!train.length || train[train.length - 1].t - train[0].t < minTrainDays * DAY) continue;
    let best: string | null = null, loss = Infinity;
    for (const k of keys) {
      const s = score(train, k);
      if (s.n < 100) continue;
      const l = s.mae15 + 0.5 * s.mae30;
      if (l < loss) { loss = l; best = k; }
    }
    if (!best) continue;
    choices.push({ day, key: best });
    for (const r of rows) if (r.t >= Math.max(day, testFrom) && r.t < day + DAY) r.preds[family] = r.preds[best];
  }
  return choices;
}

export type Verdict = 'collecting' | 'rejected' | 'not_better' | 'ready';
export const VERDICT_RULES = { minN: 300, minDays: 3, readyN: 1000, readyDays: 7, better: 0.9 };
/**
 * A candidate against what the app shows and against "no change", on the same unseen moments.
 * ready: at least 10 % lower 15-min error than both, 30-min error no worse, catches as many fast falls with no
 * more than a few extra false alarms. rejected: clearly worse than doing nothing, or far more false fall alarms.
 */
export function verdict(c: Score, prod: Score, none: Score, days: number): { verdict: Verdict; why: string } {
  const R = VERDICT_RULES;
  if (c.n < R.minN || days < R.minDays) return { verdict: 'collecting', why: 'not_enough_unseen' };
  if (c.mae15 > none.mae15 * 1.05 && c.mae30 > none.mae30 * 1.05) return { verdict: 'rejected', why: 'worse_than_no_change' };
  if (c.fall.falseAlarms > Math.max(2 * prod.fall.falseAlarms, prod.fall.falseAlarms + 10)) return { verdict: 'rejected', why: 'false_fall_alarms' };
  const ref15 = Math.min(prod.mae15, none.mae15), ref30 = Math.min(prod.mae30, none.mae30);
  const ok = c.mae15 <= R.better * ref15 && c.mae30 <= ref30 && c.fall.caught >= prod.fall.caught && c.fall.falseAlarms <= prod.fall.falseAlarms + Math.max(3, c.n * 0.005);
  if (!ok) return { verdict: 'not_better', why: c.mae15 > R.better * ref15 ? 'not_10pct_better' : c.mae30 > ref30 ? 'worse_at_30' : 'misses_falls' };
  if (c.n < R.readyN || days < R.readyDays) return { verdict: 'collecting', why: 'promising_needs_more' };
  return { verdict: 'ready', why: 'materially_better' };
}

/* ------------------------------------------------------- unexplained moves */

export type Cause = 'model_error' | 'missing_event' | 'cgm' | 'bad_input';
export type Confidence = 'high' | 'medium' | 'low';
export interface Episode {
  key: string; start: number; end: number; dir: 'rise' | 'fall'; g0: number; g1: number;
  expected: number; resid: number; iob: number; cob: number; night: boolean;
}
export interface Clues {
  uncertain: number[];                            // times of entries set aside (could be logged twice)
  sensorStarts: number[];
  fingerpricks: { t: number; cause: string }[];   // finger-prick comparisons and their named cause
  exercise: number[];
}
export type AnswerChoice = 'food' | 'insulin' | 'activity' | 'illness' | 'sensor' | 'not_eaten' | 'unknown' | 'other';
export interface Classified extends Episode { cause: Cause; autoCause: Cause; confidence: Confidence; evidence: string[]; askable: boolean }

const isNight = (t: number) => { const h = new Date(t + KW).getUTCHours(); return h >= 22 || h < 7; };

/** Effect of everything logged before t1 on the change from t0 to t1 (hindsight: entries during the window count). */
export function loggedEffect(ctx: RContext, t0: number, t1: number): number {
  const remI = (dt: number) => (dt <= 0 ? 1 : iobFraction(dt / MIN, ctx.iob));
  const remC = (dt: number) => (dt <= 0 ? 1 : Math.max(0, 1 - dt / (ctx.absorb * MIN)));
  let fx = 0;
  for (const d of ctx.doses) if (d.t < t1) { const s = Math.max(t0, d.t); fx -= d.u * (remI(s - d.t) - remI(t1 - d.t)) * ctx.isf; }
  for (const c of ctx.carbs) if (c.t < t1) { const s = Math.max(t0, c.t); fx += (c.g * (remC(s - c.t) - remC(t1 - c.t)) / ctx.cr) * ctx.isf; }
  return fx;
}

function series(all: RReading[]) {
  const keep = minuteOnly(all.map((r) => r.t), all.map((r) => r.a), all);
  const t = keep.map((r) => r.t), v = keep.map((r) => r.v);
  const near = (x: number, within = 3 * MIN) => {
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
    let b = -1;
    for (const k of [lo - 1, lo]) if (k >= 0 && k < t.length && Math.abs(t[k] - x) <= within && (b < 0 || Math.abs(t[k] - x) < Math.abs(t[b] - x))) b = k;
    return b < 0 ? null : v[b];
  };
  return { t, v, near };
}

/**
 * 30-minute windows every 5 minutes where the change differs from what the log explains by `threshold` mg/dL
 * (default 2 mmol/L) or more; overlapping windows in the same direction become one episode.
 */
export function findUnexplained(all: RReading[], ctx: RContext, from: number, to: number, threshold = 36): Episode[] {
  const { t, near } = series(all);
  if (!t.length) return [];
  const flagged: { t: number; resid: number }[] = [];
  for (let x = Math.max(from, t[0]); x + 30 * MIN <= Math.min(to, t[t.length - 1]); x += 5 * MIN) {
    const a = near(x), b = near(x + 30 * MIN);
    if (a === null || b === null) continue;
    const resid = b - a - loggedEffect(ctx, x, x + 30 * MIN);
    if (Math.abs(resid) >= threshold) flagged.push({ t: x, resid });
  }
  const groups: { t: number; resid: number }[][] = [];
  for (const f of flagged) {
    const g = groups[groups.length - 1];
    if (g && Math.sign(g[0].resid) === Math.sign(f.resid) && f.t - g[g.length - 1].t <= 15 * MIN) g.push(f); else groups.push([f]);
  }
  return groups.map((g) => {
    const start = g[0].t, end = g[g.length - 1].t + 30 * MIN;
    const g0 = near(start)!, g1 = near(end) ?? near(g[g.length - 1].t + 30 * MIN)!;
    const peak = g.reduce((m, x) => (Math.abs(x.resid) > Math.abs(m) ? x.resid : m), 0);
    const iob = ctx.doses.reduce((s, d) => s + (d.t <= start ? d.u * iobFraction((start - d.t) / MIN, ctx.iob) : 0), 0);
    const cob = ctx.carbs.reduce((s, c) => s + (c.t <= start ? c.g * Math.max(0, 1 - (start - c.t) / (ctx.absorb * MIN)) : 0), 0);
    const dir = peak > 0 ? 'rise' as const : 'fall' as const;
    return {
      key: `${dir}:${new Date(start).toISOString()}`, start, end, dir, g0, g1, expected: Math.round(loggedEffect(ctx, start, end)), resid: Math.round(peak),
      iob: Math.round(iob * 100) / 100, cob: Math.round(cob), night: isNight(start),
    };
  });
}

/** Four causes, decided from the data alone; only "missing event" may need a parent. An answer overrides. */
export function classifyEpisode(e: Episode, all: RReading[], ctx: RContext, clues: Clues, answer?: AnswerChoice | null): Classified {
  const { t, v, near } = series(all);
  const within = (list: number[], a: number, b: number) => list.some((x) => x >= a && x <= b);
  const ev: string[] = [];
  let cause: Cause, confidence: Confidence, askable = false;
  // CGM shapes
  let jump = false;
  for (let k = 1; k < t.length; k++) if (t[k] >= e.start && t[k] <= e.end && t[k] - t[k - 1] <= 3 * MIN && Math.abs(v[k] - v[k - 1]) >= 20) { jump = true; break; }
  let compression = false;
  if (e.dir === 'fall' && e.night) {
    let lowT = -1, low = Infinity;
    for (let k = 0; k < t.length; k++) if (t[k] >= e.start && t[k] <= e.end + 30 * MIN && v[k] < low) { low = v[k]; lowT = t[k]; }
    const back = lowT > 0 ? near(lowT + 45 * MIN, 10 * MIN) : null;
    const fed = ctx.carbs.some((c) => c.t >= e.start - 15 * MIN && c.t <= lowT + 45 * MIN);
    compression = low < 80 && back !== null && back - low >= 0.7 * (e.g0 - low) && !fed;
  }
  const fpBad = clues.fingerpricks.some((f) => f.t >= e.start - 30 * MIN && f.t <= e.end + 30 * MIN && (f.cause === 'compression' || f.cause === 'sensor_bias'));

  if (within(clues.uncertain, e.start - 90 * MIN, e.end)) { cause = 'bad_input'; confidence = 'medium'; ev.push('uncertain_entry'); }
  else if (compression) { cause = 'cgm'; confidence = 'high'; ev.push('compression_shape'); }
  else if (within(clues.sensorStarts, e.start - DAY, e.start)) { cause = 'cgm'; confidence = 'medium'; ev.push('sensor_new'); }
  else if (jump) { cause = 'cgm'; confidence = 'medium'; ev.push('jump'); }
  else if (fpBad) { cause = 'cgm'; confidence = 'medium'; ev.push('fingerprick_disagrees'); }
  else if (e.dir === 'rise' && ctx.carbs.some((c) => c.g >= 5 && c.t >= e.start - 4 * HOUR && c.t <= e.end)) { cause = 'model_error'; confidence = 'medium'; ev.push('carbs_logged'); }
  else if (e.dir === 'fall' && within(clues.exercise, e.start - 3 * HOUR, e.end)) { cause = 'model_error'; confidence = 'medium'; ev.push('exercise_logged'); }
  else if (e.dir === 'fall' && ctx.doses.some((d) => d.t >= e.start - 6 * HOUR && d.t <= e.end)) { cause = 'model_error'; confidence = 'low'; ev.push('insulin_logged'); }
  else { cause = 'missing_event'; confidence = 'low'; askable = true; ev.push(e.dir === 'rise' ? 'no_carbs_logged' : 'no_insulin_logged'); }
  if (e.night) ev.push('night');
  const autoCause = cause;
  if (answer && answer !== 'unknown' && answer !== 'other') {
    cause = answer === 'sensor' ? 'cgm' : answer === 'not_eaten' ? 'bad_input' : 'missing_event';
    confidence = 'high'; ev.push('parent_answer');
  }
  return { ...e, cause, autoCause, confidence, evidence: ev, askable: askable && !answer };
}

/** How much a parent's answer would teach: a bigger and fresher surprise is worth more; night ones less (asleep). */
export function infoValue(e: Classified, now: number): number {
  if (!e.askable) return 0;
  const age = now - e.end;
  const fresh = age < 6 * HOUR ? 1 : age < DAY ? 0.8 : age < 2 * DAY ? 0.5 : 0;
  return Math.round((Math.abs(e.resid) / 18.016) * fresh * (e.night ? 0.6 : 1) * 100) / 100;
}
export const QUESTION_RULES = { perDay: 3, minInfo: 2.5, duplicatePerDay: 1, duplicateMinMoments: 24 };

/** Which candidate questions to ask now: the most informative first, never more than 3 a day (counting those
 *  already asked today), at most one about a possible double entry, and only when the answer is worth it. */
export function pickQuestions(cands: { kind: 'unexplained' | 'duplicate'; ref: string; info: number }[], askedToday: { kind: string }[]): { kind: 'unexplained' | 'duplicate'; ref: string; info: number }[] {
  const R = QUESTION_RULES;
  let left = R.perDay - askedToday.length;
  let dupLeft = R.duplicatePerDay - askedToday.filter((q) => q.kind === 'duplicate').length;
  const out = [];
  const un = cands.filter((c) => c.kind === 'unexplained' && c.info >= R.minInfo).sort((a, b) => b.info - a.info);
  for (const c of un) { if (left <= 0) break; out.push(c); left--; }
  // a possible double entry only on a day with no surprise to ask about
  if (!out.length && !askedToday.some((q) => q.kind === 'unexplained')) {
    const dup = cands.filter((c) => c.kind === 'duplicate' && c.info >= 1).sort((a, b) => b.info - a.info);
    for (const c of dup) { if (left <= 0 || dupLeft <= 0) break; out.push(c); left--; dupLeft--; }
  }
  return out;
}

/* ----------------------------------------------------------------- the run */

export interface LabInput {
  readings: RReading[];
  ctx: RContext;                                    // accepted carbs and rapid insulin only
  clues: Clues;
  uncertain: { id: string; t: number }[];           // entries set aside; each excludes [t − 15 min, t + 3 h]
  answers: Record<string, AnswerChoice>;            // unexplained-event key → a parent's answer
  baselineEnd: number;                              // data after this was never seen by Baseline v1
  production: 'libre' | 'trend';
  now: number;
}
export interface ModelScore { n: number; mae15: number; mae30: number; bias15: number; direction: number; arrow: number; fall: Score['fall']; rise: Score['rise'] }
export interface LabResult {
  window: { from: number; to: number };
  data: { readings: number; moments: number; excluded: number; excludedBy: Record<string, number>; unseen: number; unseenDays: number };
  unseen: { all: Record<string, ModelScore>; bySituation: Partial<Record<Situation, Record<string, ModelScore>>> };
  choices: Record<string, { day: number; key: string }[]>;
  verdicts: Record<string, { verdict: Verdict; why: string }>;
  episodes: (Classified & { info: number })[];
  duplicates: { id: string; moments: number }[];      // what each set-aside entry keeps out of the research
}

const round = (s: Score): ModelScore => {
  const r = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
  return { n: s.n, mae15: r(s.mae15), mae30: r(s.mae30), bias15: r(s.bias15), direction: r(s.direction), arrow: r(s.arrow), fall: s.fall, rise: s.rise };
};

export function runLab(p: LabInput): LabResult {
  const R = [...p.readings].sort((a, b) => a.t - b.t);
  const from = R[0]?.t ?? p.now, to = R[R.length - 1]?.t ?? p.now;
  // 1. unexplained movements, each with a cause
  const episodes = findUnexplained(R, p.ctx, from, to).map((e) => {
    const c = classifyEpisode(e, R, p.ctx, p.clues, p.answers[e.key] ?? null);
    return { ...c, info: infoValue(c, p.now) };
  });
  // 2. what is kept out of the research, and why (nothing is deleted)
  const ex: Exclusion[] = [
    ...p.uncertain.map((u): Exclusion => [u.t - 15 * MIN, u.t + 3 * HOUR, 'uncertain_entry']),
    ...p.clues.sensorStarts.map((s): Exclusion => [s, s + HOUR, 'sensor_warmup']),
    ...episodes.filter((e) => e.cause === 'cgm').map((e): Exclusion => [e.start, e.end, 'questionable_cgm']),
    ...episodes.filter((e) => e.cause === 'bad_input' && !e.evidence.includes('uncertain_entry')).map((e): Exclusion => [e.start, e.end, 'bad_input']),
  ];
  const models = { ...MODELS, ...gridModels() };
  const { kept, excluded, excludedBy } = samples(R, p.ctx, ex, models);
  // 3. candidates that choose settings from older days only
  const choices: LabResult['choices'] = {};
  for (const fam of ['context_fit', 'damped']) choices[fam] = walkForward(kept, fam, p.baselineEnd);
  // 4. same unseen moments for everything compared
  const keys = [...new Set(['none', 'libre', 'trend', p.production, ...CANDIDATES])];
  const unseen = kept.filter((s) => s.t >= p.baselineEnd && keys.every((k) => s.preds[k]));
  const unseenDays = unseen.length ? (unseen[unseen.length - 1].t - unseen[0].t) / DAY : 0;
  const all: Record<string, ModelScore> = {}, bySituation: LabResult['unseen']['bySituation'] = {};
  for (const k of keys) all[k] = round(score(unseen, k));
  for (const sit of ['night', 'after_food', 'after_insulin', 'other'] as Situation[]) {
    const rows = unseen.filter((s) => s.situation === sit);
    if (!rows.length) continue;
    bySituation[sit] = Object.fromEntries(keys.map((k) => [k, round(score(rows, k))]));
  }
  const verdicts: LabResult['verdicts'] = {};
  for (const k of CANDIDATES) verdicts[k] = verdict(score(unseen, k), score(unseen, p.production), score(unseen, 'none'), unseenDays);
  // 5. what each set-aside entry costs the research (moments with readings that nothing else excludes)
  const minuteTimes = series(R).t;
  const duplicates = p.uncertain.map((u) => {
    const others = ex.filter((x) => !(x[0] === u.t - 15 * MIN && x[2] === 'uncertain_entry'));
    const slots = new Set<number>();
    for (const x of minuteTimes) if (x >= u.t - 15 * MIN && x <= u.t + 3 * HOUR && !others.some(([a, b]) => x >= a && x <= b)) slots.add(Math.floor(x / (5 * MIN)));
    return { id: u.id, moments: slots.size };
  });
  return {
    window: { from, to },
    data: { readings: R.length, moments: kept.length + excluded, excluded, excludedBy, unseen: unseen.length, unseenDays: Math.round(unseenDays * 10) / 10 },
    unseen: { all, bySituation }, choices, verdicts, episodes, duplicates,
  };
}
