// Research engine, first piece: score glucose predictors on past data, all the same way. Pure, tested in Node.
// Nothing here feeds the app's screens or doses; it measures. A prediction is made at a moment using only what was
// known up to that moment, then compared with what the sensor showed 15 and 30 minutes later.
import { iobFraction, type IobParams } from './iob';
import { levelOf, minuteOnly, rateBetween } from './trend';
import { median } from './meals';

const MIN = 60000, KW = 3 * 3600000;

export interface RReading { t: number; v: number; a: number | null }
export interface RDose { t: number; u: number }
export interface RCarb { t: number; g: number; fpu?: number; meal?: boolean } // fpu: fat-protein units (100 kcal of fat and protein); meal: a logged meal, not a snack carb or a treatment
export interface RContext { doses: RDose[]; carbs: RCarb[]; iob: IobParams; absorb: number; cr: number; isf: number }
export interface Prediction { v15: number; v30: number; rate: number }   // rate: mg/dL per minute over the next 15 min
export type Predictor = (i: number, t: number[], v: number[], a: (number | null)[], ctx: RContext) => Prediction | null;

const LIBRE_RATE: Record<number, number> = { 1: -2.5, 2: -1.5, 3: 0, 4: 1.5, 5: 2.5 };  // middle of each arrow's band

/** A late fat-and-protein bump: `k` grams of carb-equivalent per FPU (from 1 FPU), arriving evenly 2 to 5 hours
 *  after the meal. The meal's own carbs keep their normal absorption. */
export interface FatBump { k: number; from: number; to: number }
export const FAT_WINDOW = { from: 120, to: 300 } as const;

/** Glucose effect (mg/dL) of logged carbs and insulin between t0 and t1, from the doctor's ratios. */
export function physEffect(ctx: RContext, t0: number, t1: number, bump?: FatBump): number {
  const remI = (dt: number) => (dt <= 0 ? 1 : iobFraction(dt / MIN, ctx.iob));
  const remC = (dt: number) => (dt <= 0 ? 1 : Math.max(0, 1 - dt / (ctx.absorb * MIN)));
  // share of the bump still to come at dt minutes after the meal
  const remB = (dt: number) => (!bump ? 0 : dt <= bump.from * MIN ? 1 : dt >= bump.to * MIN ? 0 : 1 - (dt - bump.from * MIN) / ((bump.to - bump.from) * MIN));
  let fx = 0;
  for (const d of ctx.doses) if (d.t <= t0) fx -= d.u * (remI(t0 - d.t) - remI(t1 - d.t)) * ctx.isf;
  for (const c of ctx.carbs) if (c.t <= t0) {
    fx += (c.g * (remC(t0 - c.t) - remC(t1 - c.t)) / ctx.cr) * ctx.isf;
    if (bump && bump.k > 0 && (c.fpu ?? 0) >= 1) fx += ((c.fpu! * bump.k) * (remB(t0 - c.t) - remB(t1 - c.t)) / ctx.cr) * ctx.isf;
  }
  return fx;
}

/** Carbs and insulin over the horizon (doctor's ratios), plus a share `w` of the trend they do not explain. */
/** `drift`: a steady change in mg/dL per hour that carbs and insulin do not explain (e.g. a basal dose a little strong
 *  or weak), added on top. */
export function contextModel(w: number, absorb?: number, bump?: FatBump, drift = 0): Predictor {
  return (i, t, v, _a, c) => {
    const ctx = absorb ? { ...c, absorb } : c;
    const r = rateBetween(t, v, t[i] - 20 * MIN, t[i]);
    if (r === null) return null;
    const now = t[i];
    const physNow = physEffect(ctx, now - 5 * MIN, now, bump) / 5;               // what carbs and insulin explain right now (per min)
    const resid = r - physNow;                                             // the part of the trend they do not explain
    const p15 = physEffect(ctx, now, now + 15 * MIN, bump), p30 = physEffect(ctx, now, now + 30 * MIN, bump);
    const d = drift / 60; // per minute
    return { v15: v[i] + p15 + w * resid * 15 + d * 15, v30: v[i] + p30 + w * resid * 30 + d * 30, rate: (p15 + w * resid * 15) / 15 + d };
  };
}
/** The 20-minute trend, scaled by k (k < 1: assume the movement slows down). */
export function dampedTrend(k: number): Predictor {
  return (i, t, v) => { const r = rateBetween(t, v, t[i] - 20 * MIN, t[i]); return r === null ? null : { v15: v[i] + k * r * 15, v30: v[i] + k * r * 30, rate: k * r }; };
}

/**
 * Similar meals (2026-10-03): after a meal, what her own most similar past meals did next, so the dip and then the
 * bump come from her data rather than from the ratios. Similar = carbs, fat+protein (FPU), how much of the meal the
 * dose covered (units × CR ÷ carbs) and glucose at the start. A past meal only counts for the minutes of it already
 * seen at the moment of the prediction. Fewer than `minN` similar meals, or no meal in the last 5 hours: `fallback`.
 */
export const SIMILAR = { horizon: 300, k: 5, minN: 3, maxDist: 1.5, scale: { g: 20, fpu: 1.5, cover: 0.25, start: 36 } } as const;
export interface MealCase { t: number; g: number; fpu: number; cover: number; start: number }
export function mealDistance(a: MealCase, b: MealCase) {
  const s = SIMILAR.scale;
  return Math.hypot((a.g - b.g) / s.g, (a.fpu - b.fpu) / s.fpu, (a.cover - b.cover) / s.cover, (a.start - b.start) / s.start);
}
export function similarMeals(full: RContext, fallback: Predictor): Predictor {
  const meals = full.carbs.filter((c) => c.meal && c.g >= 10).sort((x, y) => x.t - y.t);
  const doses = [...full.doses].sort((x, y) => x.t - y.t);
  const cache = new WeakMap<number[], { m: RCarb; start: number; curve: (number | null)[]; next: number; c: MealCase }[]>();
  const near = (t: number[], v: number[], x: number) => {
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
    let b = -1;
    for (const k of [lo - 1, lo]) if (k >= 0 && k < t.length && Math.abs(t[k] - x) <= 3 * MIN && (b < 0 || Math.abs(t[k] - x) < Math.abs(t[b] - x))) b = k;
    return b < 0 ? null : v[b];
  };
  const caseOf = (m: RCarb, start: number, now: number): MealCase => {
    const u = doses.filter((d) => d.t >= m.t - 45 * MIN && d.t <= Math.min(now, m.t + 30 * MIN)).reduce((s, d) => s + d.u, 0);
    return { t: m.t, g: m.g, fpu: m.fpu ?? 0, cover: (u * full.cr) / m.g, start };
  };
  const steps = (SIMILAR.horizon + 30) / 5;
  // each meal's change from its start, every 5 min, until the next meal (later minutes belong to that one)
  const library = (t: number[], v: number[]) => {
    let lib = cache.get(t);
    if (!lib) {
      lib = meals.map((m, j) => {
        const start = near(t, v, m.t), next = meals[j + 1]?.t ?? Infinity;
        const curve = Array.from({ length: steps + 1 }, (_, k) => { const x = m.t + k * 5 * MIN; if (start === null || x >= next) return null; const y = near(t, v, x); return y === null ? null : y - start; });
        return { m, start: start ?? NaN, curve, next, c: caseOf(m, start ?? NaN, m.t + 30 * MIN) };
      }).filter((x) => Number.isFinite(x.start));
      cache.set(t, lib);
    }
    return lib;
  };
  return (i, t, v, a, ctx) => {
    const now = t[i];
    const lib = library(t, v);
    let cur: (typeof lib)[number] | undefined;
    for (const x of lib) { if (x.m.t > now) break; cur = x; }
    if (!cur || now - cur.m.t < 5 * MIN || now - cur.m.t > SIMILAR.horizon * MIN || now >= cur.next) return fallback(i, t, v, a, ctx);
    const e = Math.round((now - cur.m.t) / (5 * MIN));
    const me = caseOf(cur.m, cur.start, now);
    const ok = lib
      .filter((x) => x !== cur && x.m.t + (e + 6) * 5 * MIN <= now && x.curve[e] !== null && x.curve[e + 3] !== null && x.curve[e + 6] !== null)
      .map((x) => ({ x, d: mealDistance(me, x.c) }))
      .filter((y) => y.d <= SIMILAR.maxDist)
      .sort((p, q) => p.d - q.d)
      .slice(0, SIMILAR.k);
    if (ok.length < SIMILAR.minN) return fallback(i, t, v, a, ctx);
    const d15 = median(ok.map(({ x }) => x.curve[e + 3]! - x.curve[e]!))!, d30 = median(ok.map(({ x }) => x.curve[e + 6]! - x.curve[e]!))!;
    return { v15: v[i] + d15, v30: v[i] + d30, rate: d15 / 15 };
  };
}

export const MODELS: Record<string, { name: string; note: string; f: Predictor }> = {
  none: { name: 'No change', note: 'glucose stays where it is', f: (i, _t, v) => ({ v15: v[i], v30: v[i], rate: 0 }) },
  libre: {
    name: 'Libre arrow', note: "the middle of the arrow's speed band, carried forward",
    f: (i, _t, v, a) => { const r = a[i] === null ? null : LIBRE_RATE[a[i]!]; return r === undefined || r === null ? null : { v15: v[i] + r * 15, v30: v[i] + r * 30, rate: r }; },
  },
  trend: {
    name: 'App trend', note: 'least-squares rate over the last 20 min, carried forward',
    f: (i, t, v) => { const r = rateBetween(t, v, t[i] - 20 * MIN, t[i]); return r === null ? null : { v15: v[i] + r * 15, v30: v[i] + r * 30, rate: r }; },
  },
  context: { name: 'Context v1 (carbs + insulin)', note: 'logged carbs and insulin with the doctor\'s ratios, plus half of the trend they do not explain; not tuned', f: contextModel(0.5) },
};

export type Situation = 'night' | 'after_food' | 'after_insulin' | 'other';
export interface Sample { t: number; v: number; truth15: number; truth30: number; truthRate: number; situation: Situation; libreArrow: number | null; preds: Record<string, Prediction | null> }

export type Exclusion = [number, number] | [number, number, string];  // from, to, reason

/** Moments every 5 minutes with Libre's arrow, a trend, and readings 15 and 30 minutes later. Each model sees only
 *  the carbs and insulin logged up to the moment (and, for speed, only those of the last 8 hours). */
export function samples(all: RReading[], ctx: RContext, exclude: Exclusion[], models: Record<string, { f: Predictor }> = MODELS): { kept: Sample[]; excluded: number; excludedBy: Record<string, number> } {
  const keep = minuteOnly(all.map((r) => r.t), all.map((r) => r.a), all);
  const t = keep.map((r) => r.t), v = keep.map((r) => r.v), a = keep.map((r) => r.a);
  const at = (x: number) => {
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
    let b = -1;
    for (const k of [lo - 1, lo]) if (k >= 0 && k < t.length && Math.abs(t[k] - x) <= 3 * MIN && (b < 0 || Math.abs(t[k] - x) < Math.abs(t[b] - x))) b = k;
    return b < 0 ? null : v[b];
  };
  const doses = [...ctx.doses].sort((x, y) => x.t - y.t), carbs = [...ctx.carbs].sort((x, y) => x.t - y.t);
  const recent = <T extends { t: number }>(list: T[], now: number) => list.filter((e) => e.t <= now && e.t > now - 8 * 3600000);
  const out: Sample[] = []; let last = -Infinity, excluded = 0;
  const excludedBy: Record<string, number> = {};
  for (let i = 0; i < t.length; i++) {
    if (a[i] === null || t[i] - last < 5 * MIN) continue;
    const f15 = at(t[i] + 15 * MIN), f30 = at(t[i] + 30 * MIN), tr = rateBetween(t, v, t[i], t[i] + 15 * MIN, 3, 10);
    if (f15 === null || f30 === null || tr === null) continue;
    last = t[i];
    const ex = exclude.find(([x, y]) => t[i] >= x && t[i] <= y);
    if (ex) { excluded++; const why = ex[2] ?? 'excluded'; excludedBy[why] = (excludedBy[why] ?? 0) + 1; continue; }
    const kh = new Date(t[i] + KW).getUTCHours();
    const food = carbs.some((c) => c.g >= 10 && t[i] - c.t >= 0 && t[i] - c.t <= 3 * 3600000);
    const ins = doses.some((d) => t[i] - d.t >= 0 && t[i] - d.t <= 3 * 3600000);
    const situation: Situation = kh >= 22 || kh < 7 ? 'night' : food ? 'after_food' : ins ? 'after_insulin' : 'other';
    const c = { ...ctx, doses: recent(doses, t[i]), carbs: recent(carbs, t[i]) };
    const preds: Record<string, Prediction | null> = {};
    for (const [k, m] of Object.entries(models)) preds[k] = m.f(i, t, v, a, c);
    out.push({ t: t[i], v: v[i], truth15: f15, truth30: f30, truthRate: tr, situation, libreArrow: a[i], preds });
  }
  return { kept: out, excluded, excludedBy };
}

export interface Score {
  n: number; mae15: number; mae30: number; bias15: number; direction: number; arrow: number;
  /** the arrow (5 levels) right while glucose was really moving (|speed| ≥ 1 mg/dL/min): "no change" scores 0 here */
  arrowMoving?: number;
  fall: { truth: number; caught: number; falseAlarms: number }; rise: { truth: number; caught: number; falseAlarms: number };
}
const dir3 = (r: number) => (r <= -1 ? -1 : r >= 1 ? 1 : 0);
const five = (r: number) => Math.max(-2, Math.min(2, levelOf(r)));

/** Scores one model on the moments where it could predict (all models are compared on the same moments). */
export function score(rows: Sample[], key: string): Score {
  const r = rows.filter((s) => s.preds[key]);
  const n = r.length, p = (s: Sample) => s.preds[key]!;
  const m = (f: (s: Sample) => number) => (n ? r.reduce((acc, s) => acc + f(s), 0) / n : NaN);
  const cnt = (f: (s: Sample) => boolean) => r.filter(f).length;
  return {
    n, mae15: m((s) => Math.abs(p(s).v15 - s.truth15)), mae30: m((s) => Math.abs(p(s).v30 - s.truth30)), bias15: m((s) => p(s).v15 - s.truth15),
    direction: m((s) => (dir3(p(s).rate) === dir3(s.truthRate) ? 1 : 0)), arrow: m((s) => (five(p(s).rate) === five(s.truthRate) ? 1 : 0)),
    arrowMoving: (() => { const mv = r.filter((s) => Math.abs(s.truthRate) >= 1); return mv.length ? mv.filter((s) => five(p(s).rate) === five(s.truthRate)).length / mv.length : NaN; })(),
    fall: { truth: cnt((s) => s.truthRate <= -2), caught: cnt((s) => s.truthRate <= -2 && p(s).rate <= -2), falseAlarms: cnt((s) => p(s).rate <= -2 && s.truthRate > -1) },
    rise: { truth: cnt((s) => s.truthRate >= 2), caught: cnt((s) => s.truthRate >= 2 && p(s).rate >= 2), falseAlarms: cnt((s) => p(s).rate >= 2 && s.truthRate < 1) },
  };
}

/** Rapid-fall episodes (true rate ≤ −2 for consecutive moments) and how many minutes before Libre's first ↓ a model flagged each. */
export function detection(rows: Sample[], key: string, sign: -1 | 1 = -1) {
  const hit = (s: Sample) => (sign < 0 ? s.truthRate <= -2 : s.truthRate >= 2);
  const flag = (s: Sample) => { const p = s.preds[key]; return !!p && (sign < 0 ? p.rate <= -2 : p.rate >= 2); };
  const libreFlag = (s: Sample) => (sign < 0 ? s.libreArrow === 1 : s.libreArrow === 5);
  const eps: Sample[][] = [];
  for (const s of rows) { const e = eps[eps.length - 1]; if (hit(s)) { if (e && s.t - e[e.length - 1].t <= 10 * MIN) e.push(s); else eps.push([s]); } }
  return eps.map((e) => {
    const from = e[0].t - 15 * MIN, to = e[e.length - 1].t;
    const win = rows.filter((s) => s.t >= from && s.t <= to);
    const m = win.find(flag)?.t ?? null, l = win.find(libreFlag)?.t ?? null;
    return { start: e[0].t, model: m, libre: l, leadVsLibreMin: m !== null && l !== null ? Math.round((l - m) / MIN) : null };
  });
}
