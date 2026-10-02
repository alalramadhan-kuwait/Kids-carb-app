// Research engine, first piece: score glucose predictors on past data, all the same way. Pure, tested in Node.
// Nothing here feeds the app's screens or doses; it measures. A prediction is made at a moment using only what was
// known up to that moment, then compared with what the sensor showed 15 and 30 minutes later.
import { iobFraction, type IobParams } from './iob';
import { levelOf, minuteOnly, rateBetween } from './trend';

const MIN = 60000, KW = 3 * 3600000;

export interface RReading { t: number; v: number; a: number | null }
export interface RDose { t: number; u: number }
export interface RCarb { t: number; g: number }
export interface RContext { doses: RDose[]; carbs: RCarb[]; iob: IobParams; absorb: number; cr: number; isf: number }
export interface Prediction { v15: number; v30: number; rate: number }   // rate: mg/dL per minute over the next 15 min
export type Predictor = (i: number, t: number[], v: number[], a: (number | null)[], ctx: RContext) => Prediction | null;

const LIBRE_RATE: Record<number, number> = { 1: -2.5, 2: -1.5, 3: 0, 4: 1.5, 5: 2.5 };  // middle of each arrow's band

/** Glucose effect (mg/dL) of logged carbs and insulin between t0 and t1, from the doctor's ratios. */
export function physEffect(ctx: RContext, t0: number, t1: number): number {
  const remI = (dt: number) => (dt <= 0 ? 1 : iobFraction(dt / MIN, ctx.iob));
  const remC = (dt: number) => (dt <= 0 ? 1 : Math.max(0, 1 - dt / (ctx.absorb * MIN)));
  let fx = 0;
  for (const d of ctx.doses) if (d.t <= t0) fx -= d.u * (remI(t0 - d.t) - remI(t1 - d.t)) * ctx.isf;
  for (const c of ctx.carbs) if (c.t <= t0) fx += (c.g * (remC(t0 - c.t) - remC(t1 - c.t)) / ctx.cr) * ctx.isf;
  return fx;
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
  context: {
    name: 'Context v1 (carbs + insulin)', note: 'logged carbs and insulin with the doctor\'s ratios, plus half of the trend they do not explain; not tuned',
    f: (i, t, v, _a, ctx) => {
      const r = rateBetween(t, v, t[i] - 20 * MIN, t[i]);
      if (r === null) return null;
      const now = t[i];
      const physNow = (physEffect(ctx, now - 5 * MIN, now)) / 5;           // what carbs and insulin explain right now (per min)
      const resid = r - physNow;                                            // the part of the trend they do not explain
      const p15 = physEffect(ctx, now, now + 15 * MIN), p30 = physEffect(ctx, now, now + 30 * MIN);
      return { v15: v[i] + p15 + 0.5 * resid * 15, v30: v[i] + p30 + 0.5 * resid * 30, rate: (p15 + 0.5 * resid * 15) / 15 };
    },
  },
};

export type Situation = 'night' | 'after_food' | 'after_insulin' | 'other';
export interface Sample { t: number; v: number; truth15: number; truth30: number; truthRate: number; situation: Situation; libreArrow: number | null; preds: Record<string, Prediction | null> }

/** Moments every 5 minutes with Libre's arrow, a trend, and readings 15 and 30 minutes later. */
export function samples(all: RReading[], ctx: RContext, exclude: [number, number][], models = MODELS): { kept: Sample[]; excluded: number } {
  const keep = minuteOnly(all.map((r) => r.t), all.map((r) => r.a), all);
  const t = keep.map((r) => r.t), v = keep.map((r) => r.v), a = keep.map((r) => r.a);
  const at = (x: number) => { let b = -1; for (let k = 0; k < t.length; k++) if (Math.abs(t[k] - x) <= 3 * MIN && (b < 0 || Math.abs(t[k] - x) < Math.abs(t[b] - x))) b = k; return b < 0 ? null : v[b]; };
  const out: Sample[] = []; let last = -Infinity, excluded = 0;
  for (let i = 0; i < t.length; i++) {
    if (a[i] === null || t[i] - last < 5 * MIN) continue;
    const f15 = at(t[i] + 15 * MIN), f30 = at(t[i] + 30 * MIN), tr = rateBetween(t, v, t[i], t[i] + 15 * MIN, 3, 10);
    if (f15 === null || f30 === null || tr === null) continue;
    last = t[i];
    if (exclude.some(([x, y]) => t[i] >= x && t[i] <= y)) { excluded++; continue; }
    const kh = new Date(t[i] + KW).getUTCHours();
    const food = ctx.carbs.some((c) => c.g >= 10 && t[i] - c.t >= 0 && t[i] - c.t <= 3 * 3600000);
    const ins = ctx.doses.some((d) => t[i] - d.t >= 0 && t[i] - d.t <= 3 * 3600000);
    const situation: Situation = kh >= 22 || kh < 7 ? 'night' : food ? 'after_food' : ins ? 'after_insulin' : 'other';
    const preds: Record<string, Prediction | null> = {};
    for (const [k, m] of Object.entries(models)) preds[k] = m.f(i, t, v, a, ctx);
    out.push({ t: t[i], v: v[i], truth15: f15, truth30: f30, truthRate: tr, situation, libreArrow: a[i], preds });
  }
  return { kept: out, excluded };
}

export interface Score {
  n: number; mae15: number; mae30: number; bias15: number; direction: number; arrow: number;
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
