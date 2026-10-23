// The forecast benchmark (master plan §6). Pure, tested in Node, and bundled unchanged into the server function
// supabase/functions/carb-benchmark, which runs it on her data and stores only the results.
//
// Each candidate predicts glucose 30, 60, 120 and 240 minutes after an origin (every 15 minutes), using only what was
// known at that origin: readings taken by then, and entries already logged by then (an entry logged later, even with
// an earlier time, is not used). Error is against the sensor reading nearest the target time (within 5 minutes).
// The last TEST_DAYS are the test period; everything tuned (the 10–90 % error band) comes from before it, with a gap
// as long as the longest horizon so no window spans both. Nothing here proposes a dose or feeds the dose calculator.
//
// Candidates:
//   persist  glucose stays where it is
//   trend    the app's fading trend (trend.ts, the Home «≈» line), carried to each horizon
//   v1       the curve model frozen with meals today: linear carbs over the absorption time, the insulin curve, CR/ISF
//   v2       the same with the shared fast/slow absorption (absorb.ts)
//   v2rc     v2 plus Loop's retrospective correction: the last 30 minutes' unexplained change, fading over 60 minutes

import { stillToAbsorb, type FoodIn } from './absorb';
import { iobFraction, type IobParams } from './insulinCurve';
import { dampedChange, trendFrom } from './trend';

const MIN = 60000, DAY = 86400000, KW = 3 * 3600000;
export const HORIZONS = [30, 60, 120, 240] as const;
export const MODELS = ['persist', 'trend', 'v1', 'v2', 'v2rc'] as const;
export type Model = (typeof MODELS)[number];
/** Stored with every forecast and result so a later model can never be confused with this one. */
export const MODEL_VERSION: Record<Model, string> = { persist: 'persist-1', trend: 'trend-damp0.5', v1: 'v1-linear', v2: 'v2-split', v2rc: 'v2-split-rc60' };
export const BENCH_VERSION = 'bench-1';
export const TEST_DAYS = 7, STEP_MIN = 15, NEAR_MIN = 5, LOW = 70, MG = 18.016;

export interface BReading { t: number; v: number; trend: number | null }
export interface BDose { t: number; known: number; units: number }
export interface BFood extends FoodIn { known: number; meal: boolean } // meal: a logged meal (not a juice treatment)
export interface BParams { from: number; dia: number; peak: number; absorb: number; cr: number; isf: number }
export interface BData { readings: BReading[]; doses: BDose[]; foods: BFood[]; params: BParams[] }

const paramsAt = (ps: BParams[], t: number) => { let p: BParams | null = null; for (const x of ps) if (x.from <= t && (!p || x.from >= p.from)) p = x; return p ?? ps[0] ?? null; };
const iobOf = (doses: BDose[], t: number, p: IobParams) => doses.reduce((s, d) => s + (d.t <= t ? d.units * iobFraction((t - d.t) / MIN, p) : 0), 0);
const linLeft = (foods: BFood[], t: number, absorb: number) => foods.reduce((s, f) => { const m = (t - f.t) / MIN; return s + (m < 0 ? f.carbs : m >= absorb ? 0 : f.carbs * (1 - m / absorb)); }, 0);
const clamp = (v: number) => Math.max(40, Math.min(400, v));

/** First index with t >= x (readings sorted by time). */
function lowerBound(r: BReading[], x: number) { let lo = 0, hi = r.length; while (lo < hi) { const m = (lo + hi) >> 1; if (r[m].t < x) lo = m + 1; else hi = m; } return lo; }
/** The reading nearest `t` within NEAR_MIN, or null. */
export function readingNear(r: BReading[], t: number): BReading | null {
  const i = lowerBound(r, t); let best: BReading | null = null;
  for (const k of [i - 1, i]) { const x = r[k]; if (x && Math.abs(x.t - t) <= NEAR_MIN * MIN && (!best || Math.abs(x.t - t) < Math.abs(best.t - t))) best = x; }
  return best;
}

/** Glucose change from carbs and insulin between a and b, as the curve models see it at `known` (mg/dL). */
function effect(kind: 'v1' | 'v2', d: BData, known: number, a: number, b: number, p: BParams) {
  const foods = d.foods.filter((f) => f.known <= known && f.t <= b), doses = d.doses.filter((x) => x.known <= known && x.t <= b);
  const ip = { dia: p.dia, peak: p.peak };
  const absorbed = kind === 'v1' ? linLeft(foods, a, p.absorb) - linLeft(foods, b, p.absorb) : stillToAbsorb(foods, a) - stillToAbsorb(foods, b);
  const acted = iobOf(doses, a, ip) - iobOf(doses, b, ip);
  return (absorbed / p.cr) * p.isf - acted * p.isf;
}

/** Every candidate's forecast at `o`, or null when there is no reading in the 10 minutes before it. */
export function forecastAt(d: BData, o: number): { g0: number; pred: Record<Model, number[]> } | null {
  const i = lowerBound(d.readings, o + 1) - 1, last = d.readings[i];
  if (!last || o - last.t > 10 * MIN) return null;
  const g0 = last.v, p = paramsAt(d.params, o);
  // only entries that can still act (the last 13 hours, up to the longest horizon): the same result, much less work
  d = { ...d, foods: d.foods.filter((f) => f.t > o - 13 * 3600000 && f.t <= o + 240 * MIN), doses: d.doses.filter((x) => x.t > o - 13 * 3600000 && x.t <= o + 240 * MIN) };
  const recent = d.readings.slice(lowerBound(d.readings, o - 25 * MIN), i + 1)
    .map((r) => ({ taken_at: new Date(r.t).toISOString(), mg_dl: r.v, trend: r.trend }));
  const tr = trendFrom(recent as never, o);
  const base = tr?.projected30 != null ? tr.projected30 - dampedChange(tr.rate, 30) : null;
  const pred = {} as Record<Model, number[]>;
  pred.persist = HORIZONS.map(() => g0);
  pred.trend = HORIZONS.map((h) => (base !== null ? clamp(base + dampedChange(tr!.rate, h)) : g0)); // no solid trend: no change
  if (!p) { pred.v1 = pred.v2 = pred.v2rc = [...pred.persist]; return { g0, pred }; }
  pred.v1 = HORIZONS.map((h) => clamp(g0 + effect('v1', d, o, o, o + h * MIN, p)));
  pred.v2 = HORIZONS.map((h) => clamp(g0 + effect('v2', d, o, o, o + h * MIN, p)));
  // retrospective correction: what the last 30 minutes did that v2's effects did not explain, as a rate that fades
  // to nothing over 60 minutes (Loop's default); none without a reading 30 minutes back
  const back = readingNear(d.readings, o - 30 * MIN);
  const rate = back ? ((g0 - back.v) - effect('v2', d, o, back.t, last.t, p)) / ((last.t - back.t) / MIN || 30) : 0;
  const rc = (h: number) => rate * (h >= 60 ? 30 : h - (h * h) / 120);
  pred.v2rc = HORIZONS.map((h, k) => clamp(pred.v2[k] + rc(h)));
  return { g0, pred };
}

export type Context = 'meal_fatty' | 'meal' | 'fasting' | 'other';
/** What was going on at the origin, from what was known then: a meal in the last 4 h (fatty: fat ≥ 8 g), nothing
 *  eaten or injected for 4 h (fasting), or other (a juice or insulin only). */
export function contextAt(d: BData, o: number): Context {
  const win = (t: number) => t <= o && o - t < 4 * 3600000;
  const meals = d.foods.filter((f) => f.known <= o && win(f.t) && f.meal);
  if (meals.length) return meals.some((f) => (f.fat ?? 0) >= 8) ? 'meal_fatty' : 'meal';
  if (!d.foods.some((f) => f.known <= o && win(f.t)) && !d.doses.some((x) => x.known <= o && win(x.t))) return 'fasting';
  return 'other';
}

export interface Row { o: number; h: number; model: Model; pred: number; actual: number; g0: number; ctx: Context; night: boolean; clean: boolean }

/** All forecasts with an actual reading, from `from` to the last reading. clean: nothing logged between the origin
 *  and the target (no food or insulin the models could not have known). */
export function rowsOf(d: BData, from: number, to: number): Row[] {
  const out: Row[] = [];
  for (let o = Math.ceil(from / (STEP_MIN * MIN)) * STEP_MIN * MIN; o <= to; o += STEP_MIN * MIN) {
    const f = forecastAt(d, o); if (!f) continue;
    const ctx = contextAt(d, o), hr = new Date(o + KW).getUTCHours(), night = hr >= 22 || hr < 6;
    HORIZONS.forEach((h, k) => {
      const a = readingNear(d.readings, o + h * MIN); if (!a) return;
      const clean = !d.foods.some((x) => x.t > o && x.t <= o + h * MIN) && !d.doses.some((x) => x.t > o && x.t <= o + h * MIN);
      for (const m of MODELS) out.push({ o, h, model: m, pred: f.pred[m][k], actual: a.v, g0: f.g0, ctx, night, clean });
    });
  }
  return out;
}

const q = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface Score {
  n: number; mae: number; median: number; p90: number; bias: number;  // mmol/L
  direction: number | null; dirN: number;                             // share of real moves (≥ 1 mmol/L) called the right way
  lowN: number; missedLow: number | null;                             // actual < 3.9: share forecast ≥ 3.9 (false reassurance)
  lowAlarms: number; falseLowAlarm: number | null;                    // forecast < 3.9: share where actual stayed ≥ 4.4
  coverage: number | null;                                            // actual inside the 10–90 % band from the training period
}
export function score(rows: Row[], band?: { lo: number; hi: number }): Score {
  const err = rows.map((r) => (r.pred - r.actual) / MG), ae = err.map(Math.abs);
  const moves = rows.filter((r) => Math.abs(r.actual - r.g0) >= MG);
  const lows = rows.filter((r) => r.actual < LOW), alarms = rows.filter((r) => r.pred < LOW);
  const inBand = band ? rows.filter((r) => r.actual - r.pred >= band.lo && r.actual - r.pred <= band.hi).length : 0;
  return {
    n: rows.length, mae: r2(ae.reduce((s, x) => s + x, 0) / (ae.length || 1)), median: r2(q(ae, 0.5)), p90: r2(q(ae, 0.9)), bias: r2(err.reduce((s, x) => s + x, 0) / (err.length || 1)),
    direction: moves.length ? r2(moves.filter((r) => Math.sign(r.pred - r.g0) === Math.sign(r.actual - r.g0)).length / moves.length) : null, dirN: moves.length,
    lowN: lows.length, missedLow: lows.length ? r2(lows.filter((r) => r.pred >= LOW).length / lows.length) : null,
    lowAlarms: alarms.length, falseLowAlarm: alarms.length ? r2(alarms.filter((r) => r.actual >= 80).length / alarms.length) : null,
    coverage: band && rows.length ? r2(inBand / rows.length) : null,
  };
}

/** A 95 % interval for (model MAE − persistence MAE), resampling whole days (readings within a day are not independent). */
export function maeGapCI(rows: Row[], model: Model, h: number, draws = 400, seed = 7): { gap: number; lo: number; hi: number } {
  const byDay = new Map<number, { m: number; mn: number; p: number; pn: number }>(); // per day: error sums and counts
  for (const r of rows) if (r.h === h && (r.model === model || r.model === 'persist')) {
    const k = Math.floor((r.o + KW) / DAY), e = byDay.get(k) ?? { m: 0, mn: 0, p: 0, pn: 0 }, ae = Math.abs(r.pred - r.actual) / MG;
    if (r.model === model) { e.m += ae; e.mn++; } else { e.p += ae; e.pn++; }
    byDay.set(k, e);
  }
  const days = [...byDay.values()];
  const gapOf = (ds: typeof days) => { let m = 0, mn = 0, p = 0, pn = 0; for (const x of ds) { m += x.m; mn += x.mn; p += x.p; pn += x.pn; } return m / (mn || 1) - p / (pn || 1); };
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const gs: number[] = [];
  for (let i = 0; i < draws; i++) gs.push(gapOf(days.map(() => days[Math.floor(rnd() * days.length)])));
  return { gap: r2(gapOf(days)), lo: r2(q(gs, 0.025)), hi: r2(q(gs, 0.975)) };
}

export interface BenchResult {
  version: string; models: Record<Model, string>; from: number; to: number; testFrom: number; days: { train: number; test: number };
  bands: Record<string, { lo: number; hi: number }>;                  // `${model}:${h}` → 10/90 % of (actual − forecast), mg/dL
  test: Record<string, Score>;                                         // `${model}:${h}` and `${model}:${h}:${stratum}`
  gap: Record<string, { gap: number; lo: number; hi: number }>;       // `${model}:${h}` vs persistence, test period
  verdict: Record<string, 'better' | 'no_different' | 'worse'>;       // per model:h, from the interval above
}

const STRATA: [string, (r: Row) => boolean][] = [
  ['low', (r) => r.actual < LOW], ['range', (r) => r.actual >= LOW && r.actual <= 180], ['high', (r) => r.actual > 180],
  ['meal_fatty', (r) => r.ctx === 'meal_fatty'], ['meal', (r) => r.ctx === 'meal'], ['fasting', (r) => r.ctx === 'fasting'],
  ['night', (r) => r.night], ['clean', (r) => r.clean],
];

export function benchmark(d: BData): BenchResult | null {
  if (d.readings.length < 100) return null;
  const from = d.readings[0].t, to = d.readings[d.readings.length - 1].t, testFrom = to - TEST_DAYS * DAY;
  const rows = rowsOf(d, from + 30 * MIN, to);
  const train = rows.filter((r) => r.o + 240 * MIN < testFrom), test = rows.filter((r) => r.o >= testFrom);
  const res: BenchResult = { version: BENCH_VERSION, models: MODEL_VERSION, from, to, testFrom, days: { train: Math.round((testFrom - from) / DAY), test: TEST_DAYS }, bands: {}, test: {}, gap: {}, verdict: {} };
  for (const m of MODELS) for (const h of HORIZONS) {
    const k = `${m}:${h}`, tr = train.filter((r) => r.model === m && r.h === h), te = test.filter((r) => r.model === m && r.h === h);
    const resid = tr.map((r) => r.actual - r.pred);
    const band = resid.length >= 30 ? { lo: Math.round(q(resid, 0.1)), hi: Math.round(q(resid, 0.9)) } : undefined;
    if (band) res.bands[k] = band;
    res.test[k] = score(te, band);
    for (const [name, f] of STRATA) { const xs = te.filter(f); if (xs.length) res.test[`${k}:${name}`] = score(xs, band); }
    if (m !== 'persist') {
      const g = maeGapCI(test, m, h); res.gap[k] = g;
      res.verdict[k] = g.hi < 0 ? 'better' : g.lo > 0 ? 'worse' : 'no_different';
    }
  }
  return res;
}

/** The forecasts to store now (shadow mode: kept, never shown), with the band from the latest benchmark. */
export function shadowNow(d: BData, now: number, bands: Record<string, { lo: number; hi: number }> = {}) {
  const o = Math.floor(now / (STEP_MIN * MIN)) * STEP_MIN * MIN, f = forecastAt(d, o);
  if (!f) return [];
  return MODELS.flatMap((m) => HORIZONS.map((h, k) => {
    const b = bands[`${m}:${h}`], v = Math.round(f.pred[m][k]);
    return { model: m, model_version: MODEL_VERSION[m], origin: new Date(o).toISOString(), horizon_min: h, g0: f.g0, value_mgdl: v,
      lo_mgdl: b ? Math.round(v + b.lo) : null, hi_mgdl: b ? Math.round(v + b.hi) : null, context: contextAt(d, o) };
  }));
}
