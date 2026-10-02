// Finger-prick vs sensor. Pure, tested in Node. A finger-prick measures blood glucose; Libre measures the fluid
// under the skin, which follows blood with a delay of several minutes, more while glucose moves. So a difference
// is not simply "sensor error": each test is compared with Libre at the time, ~5 and ~10 minutes later, and the
// likely cause is named. Sensor bias is only estimated from good tests while glucose was steady.
import { minuteOnly } from './trend';

const MIN = 60000, DAY = 86400000, KW = 3 * 3600000;

export type FpState = 'stable' | 'rising' | 'falling' | 'unknown';
export type FpQuality = 'good' | 'fair' | 'poor';
export type FpCause = 'agrees' | 'sensor_bias' | 'cgm_lag' | 'rapid_change' | 'compression' | 'insufficient';
export interface FpInput {
  t: number; bg: number;                       // test time, finger-prick mg/dL
  enteredLateMin: number | null;               // how long after the test it was logged (null: unknown, e.g. imported)
  handsClean: boolean | null;
  readings: { t: number; v: number; a: number | null }[]; // sorted; a = Libre's arrow
  sensor: { sn: string; startedAt: number } | null;
  lastMeal: number | null; lastInsulin: number | null;
  now: number;
}
export interface FpResult {
  libre_now: number | null; libre_now_at: number | null; libre_5: number | null; libre_10: number | null;
  app_est: number | null; arrow: number | null; rate: number | null; state: FpState;
  diff_mgdl: number | null; diff_pct: number | null; best: 'now' | 'plus5' | 'plus10' | null; best_diff_mgdl: number | null;
  sensor_sn: string | null; sensor_day: number | null; since_meal_min: number | null; since_insulin_min: number | null;
  night: boolean; quality: FpQuality; cause: FpCause; complete: boolean;
}

/** Agreement used everywhere in this file: within 15 mg/dL (0.8 mmol/L) or 15 % of the finger-prick. */
export const agreesWith = (bg: number, libre: number) => Math.abs(libre - bg) <= Math.max(15, 0.15 * bg);

export function compareFingerprick(p: FpInput): FpResult {
  const keep = minuteOnly(p.readings.map((r) => r.t), p.readings.map((r) => r.a), p.readings);
  const near = (at: number, within: number) => {
    let best: (typeof keep)[number] | null = null;
    for (const r of keep) if (Math.abs(r.t - at) <= within && (!best || Math.abs(r.t - at) < Math.abs(best.t - at))) best = r;
    return best;
  };
  const now = near(p.t, 5 * MIN), p5 = near(p.t + 5 * MIN, 3 * MIN), p10 = near(p.t + 10 * MIN, 3 * MIN);

  // the trend up to the test: least squares over the 15 minutes before it, never across a 16-minute gap
  const win = keep.filter((r) => r.t <= p.t + MIN && r.t >= p.t - 15 * MIN);
  let rate: number | null = null, appEst: number | null = null;
  if (win.length >= 3 && (win[win.length - 1].t - win[0].t) >= 5 * MIN && win.every((r, i) => !i || r.t - win[i - 1].t <= 16 * MIN)) {
    const mt = win.reduce((s, r) => s + r.t, 0) / win.length, mv = win.reduce((s, r) => s + r.v, 0) / win.length;
    let num = 0, den = 0; for (const r of win) { const dt = (r.t - mt) / MIN; num += dt * (r.v - mv); den += dt * dt; }
    if (den) { rate = num / den; appEst = Math.round(mv + rate * ((p.t - mt) / MIN)); }
  }
  const state: FpState = rate === null ? 'unknown' : Math.abs(rate) < 1 ? 'stable' : rate > 0 ? 'rising' : 'falling';
  const diff = now ? now.v - p.bg : null;
  const cands: ['now' | 'plus5' | 'plus10', { v: number }][] = [];
  if (now) cands.push(['now', now]); if (p5) cands.push(['plus5', p5]); if (p10) cands.push(['plus10', p10]);
  const bestC = cands.sort((a, b) => Math.abs(a[1].v - p.bg) - Math.abs(b[1].v - p.bg))[0] ?? null;
  const kh = new Date(p.t + KW).getUTCHours(), night = kh >= 22 || kh < 7;

  const late = p.enteredLateMin !== null && p.enteredLateMin > 30;
  const ateSoon = p.lastMeal !== null && p.lastMeal <= p.t && p.t - p.lastMeal <= 30 * MIN;
  const quality: FpQuality = !now || (rate !== null && Math.abs(rate) >= 2) || late || p.handsClean === false ? 'poor'
    : state === 'stable' && !ateSoon && Math.abs(now.t - p.t) <= 3 * MIN && (p.enteredLateMin === null || p.enteredLateMin <= 10) ? 'good' : 'fair';

  let cause: FpCause;
  const fingerAhead = diff !== null && rate !== null && Math.sign(p.bg - now!.v) === Math.sign(rate); // blood leads in the direction of change
  const sinceFood = p.lastMeal !== null && p.lastMeal <= p.t ? (p.t - p.lastMeal) / MIN : null;
  if (!now || diff === null) cause = 'insufficient';
  // carbs in the last 30 min reach the blood before the sensor's fluid: a finger-prick above Libre is expected
  else if (sinceFood !== null && sinceFood <= 30 && p.bg > now.v && !agreesWith(p.bg, now.v)) cause = 'cgm_lag';
  else if (night && now.v < 80 && p.bg - now.v >= 18 && p.bg >= 80) cause = 'compression';      // sensor low at night, blood fine
  else if (rate !== null && Math.abs(rate) >= 2) cause = 'rapid_change';
  // moving glucose, blood ahead of the sensor, and Libre a few minutes later clearly closer: the sensor was lagging
  else if (state !== 'stable' && state !== 'unknown' && fingerAhead && bestC && bestC[0] !== 'now' && Math.abs(bestC[1].v - p.bg) + 5 <= Math.abs(diff) && agreesWith(p.bg, bestC[1].v)) cause = 'cgm_lag';
  else if (agreesWith(p.bg, now.v)) cause = 'agrees';
  else if (state === 'stable') cause = 'sensor_bias';
  else cause = 'insufficient';

  return {
    libre_now: now?.v ?? null, libre_now_at: now?.t ?? null, libre_5: p5?.v ?? null, libre_10: p10?.v ?? null,
    app_est: appEst, arrow: now?.a ?? null, rate: rate === null ? null : Math.round(rate * 100) / 100, state,
    diff_mgdl: diff, diff_pct: diff === null ? null : Math.round((diff / p.bg) * 1000) / 10,
    best: bestC ? bestC[0] : null, best_diff_mgdl: bestC ? bestC[1].v - p.bg : null,
    sensor_sn: p.sensor?.sn ?? null, sensor_day: p.sensor ? Math.floor((p.t - p.sensor.startedAt) / DAY) + 1 : null,
    since_meal_min: p.lastMeal !== null && p.lastMeal <= p.t ? Math.round((p.t - p.lastMeal) / MIN) : null,
    since_insulin_min: p.lastInsulin !== null && p.lastInsulin <= p.t ? Math.round((p.t - p.lastInsulin) / MIN) : null,
    night, quality, cause, complete: !!p10 || p.now - p.t > 20 * MIN,
  };
}

export interface Group { n: number; mean: number | null; mad: number | null; mard: number | null }
export interface SensorProfile {
  n: number; all: Group; byState: Record<'stable' | 'rising' | 'falling', Group>; byDay: { day: number; g: Group }[];
  goodStable: Group; bias: { mgdl: number; sd: number; n: number } | null; // only from 4+ good tests while steady
}
const group = (rows: { diff_mgdl: number | null; bg: number }[]): Group => {
  const r = rows.filter((x) => x.diff_mgdl !== null);
  const n = r.length;
  return n ? { n, mean: r.reduce((s, x) => s + x.diff_mgdl!, 0) / n, mad: r.reduce((s, x) => s + Math.abs(x.diff_mgdl!), 0) / n, mard: (r.reduce((s, x) => s + Math.abs(x.diff_mgdl!) / x.bg, 0) / n) * 100 }
    : { n: 0, mean: null, mad: null, mard: null };
};
export const MIN_BIAS_TESTS = 4;

export function sensorProfile(rows: (FpResult & { bg: number })[]): SensorProfile {
  const st = (s: FpState) => group(rows.filter((r) => r.state === s));
  const days = [...new Set(rows.map((r) => r.sensor_day).filter((d): d is number => d !== null))].sort((a, b) => a - b);
  const good = rows.filter((r) => r.quality === 'good' && r.state === 'stable' && r.diff_mgdl !== null);
  const gs = group(good);
  const sd = gs.n >= 2 ? Math.sqrt(good.reduce((s, r) => s + (r.diff_mgdl! - gs.mean!) ** 2, 0) / (gs.n - 1)) : 0;
  return {
    n: rows.length, all: group(rows), byState: { stable: st('stable'), rising: st('rising'), falling: st('falling') },
    byDay: days.map((day) => ({ day, g: group(rows.filter((r) => r.sensor_day === day)) })),
    goodStable: gs, bias: gs.n >= MIN_BIAS_TESTS ? { mgdl: gs.mean!, sd, n: gs.n } : null,
  };
}
