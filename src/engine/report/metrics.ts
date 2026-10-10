// Clinical report engine, part 2: the glucose numbers on an AGP report, by the international consensus
// (Battelino 2019 time-in-range consensus; Battelino 2023 CGM metrics consensus; ISPAD 2024 targets for children).
// Every number is weighted by time (see cgm.ts). Finger-pricks never enter these numbers.
import { DAY, MIN, segments, type Reading } from './cgm';

/** Consensus bands in whole mg/dL, as stored: very low <54, low 54–69, in range 70–180, high 181–250, very high >250. */
export const BAND_MG = { veryLow: 54, low: 70, high: 180, veryHigh: 250 } as const;
/** Time in tight range (ISPAD 2024): 70–140 mg/dL, 3.9–7.8 mmol/L. */
export const TIGHT_MG = { low: 70, high: 140 } as const;
/** Data needed for a standard AGP: at least 14 days with at least 70% of the time measured. */
export const SUFFICIENT = { days: 14, pctActive: 70 } as const;

export interface CgmMetrics {
  from: number; to: number;          // the period actually measured against: `to` is never after now
  days: number;                      // length of the period in days
  minutesMeasured: number;
  pctActive: number;                 // % of the period with sensor data ("% time sensor active")
  mean: number | null;               // mg/dL, time-weighted
  sd: number | null;                 // mg/dL, time-weighted population SD
  cv: number | null;                 // %, SD ÷ mean
  gmi: number | null;                // %, 3.31 + 0.02392 × mean mg/dL (Bergenstal 2018); null when the data is not enough
  pct: { veryLow: number; low: number; inRange: number; high: number; veryHigh: number; tight: number } | null;
  enough: { agp: boolean; gmi: boolean; reason: string | null };
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function cgmMetrics(rs: Reading[], from: number, to: number, now = Date.now()): CgmMetrics {
  const end = Math.min(to, now), span = Math.max(0, end - from);
  const segs = segments(rs, from, end);
  let m = 0, s1 = 0;
  for (const g of segs) { const d = g.b - g.a; m += d; s1 += g.mg * d; }
  const days = span / DAY;
  const pctActive = span ? (m / span) * 100 : 0;
  const enoughAgp = days >= SUFFICIENT.days - 1e-9 && pctActive >= SUFFICIENT.pctActive;
  const reason = days < SUFFICIENT.days - 1e-9 ? `only ${round(days, 1)} of ${SUFFICIENT.days} days` : pctActive < SUFFICIENT.pctActive ? `sensor data ${round(pctActive, 0)}% of the time (needs ${SUFFICIENT.pctActive}%)` : null;
  if (!m) return { from, to: end, days, minutesMeasured: 0, pctActive: 0, mean: null, sd: null, cv: null, gmi: null, pct: null, enough: { agp: false, gmi: false, reason: reason ?? 'no sensor data' } };
  const mean = s1 / m;
  let s2 = 0;
  const t = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0, tight: 0 };
  for (const g of segs) {
    const d = g.b - g.a, v = g.mg;
    s2 += d * (v - mean) ** 2;
    if (v < BAND_MG.veryLow) t.veryLow += d; else if (v < BAND_MG.low) t.low += d;
    else if (v <= BAND_MG.high) t.inRange += d; else if (v <= BAND_MG.veryHigh) t.high += d; else t.veryHigh += d;
    if (v >= TIGHT_MG.low && v <= TIGHT_MG.high) t.tight += d;
  }
  const sd = Math.sqrt(s2 / m);
  const pc = (x: number) => (x / m) * 100;
  return {
    from, to: end, days, minutesMeasured: m / MIN, pctActive, mean, sd, cv: (sd / mean) * 100,
    gmi: enoughAgp ? 3.31 + 0.02392 * mean : null,
    pct: { veryLow: pc(t.veryLow), low: pc(t.low), inRange: pc(t.inRange), high: pc(t.high), veryHigh: pc(t.veryHigh), tight: pc(t.tight) },
    enough: { agp: enoughAgp, gmi: enoughAgp, reason },
  };
}

/** ISPAD 2024 CGM targets for children and adolescents, shown beside the results (none is a treatment instruction). */
export const ISPAD_TARGETS = [
  { key: 'inRange', op: '>', pct: 70, label: 'Time in range 3.9–10.0 mmol/L' },
  { key: 'low+veryLow', op: '<', pct: 4, label: 'Time below 3.9 mmol/L' },
  { key: 'veryLow', op: '<', pct: 1, label: 'Time below 3.0 mmol/L' },
  { key: 'high+veryHigh', op: '<', pct: 25, label: 'Time above 10.0 mmol/L' },
  { key: 'veryHigh', op: '<', pct: 5, label: 'Time above 13.9 mmol/L' },
  { key: 'tight', op: '>', pct: 50, label: 'Time in tight range 3.9–7.8 mmol/L (newer metric)' },
] as const;
export const CV_STABLE = 36; // % (2019 consensus): at or below is "stable"

export function targetMet(p: NonNullable<CgmMetrics['pct']>, key: (typeof ISPAD_TARGETS)[number]['key']): boolean {
  const target = ISPAD_TARGETS.find((x) => x.key === key)!;
  const v = key.split('+').reduce((s, k) => s + p[k as keyof typeof p], 0);
  return target.op === '>' ? v > target.pct : v < target.pct;
}
