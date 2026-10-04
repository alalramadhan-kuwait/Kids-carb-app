// Growth against the WHO Growth Reference 2007 (5–19 years). Pure, tested in Node. The reference data are in
// who2007.ts, copied verbatim from WHO's tables; the method below follows WHO's "Computation of centiles and
// z-scores for height-for-age, weight-for-age and BMI-for-age" (WHO 2007). Thresholds marked APP RULE are this app's
// pattern-detection choices, not WHO standards, and are listed in docs/GROWTH_NUTRITION.md for the care team.
import { BMI_GIRLS, HFA_GIRLS, WFA_GIRLS, type LmsTable } from './who2007';

const DAY = 86400000;
export type Sex = 'female' | 'male';
export type Indicator = 'bmi' | 'hfa' | 'wfa';
export interface Measurement { id?: string; on: string; weight_kg: number | null; height_cm: number | null; place?: string | null; note?: string | null }

/** Age in months (WHO: days ÷ 30.4375). */
export const ageMonths = (birth: string, on: string) => (Date.parse(on) - Date.parse(birth)) / DAY / 30.4375;
export const ageYears = (birth: string, on: string) => ageMonths(birth, on) / 12;
export const bmiOf = (kg: number, cm: number) => kg / (cm / 100) ** 2;

const TABLE: Record<Indicator, LmsTable> = { bmi: BMI_GIRLS, hfa: HFA_GIRLS, wfa: WFA_GIRLS };
/** Months each indicator covers: BMI and height 61–228 (5–19 y), weight 61–120 (5–10 y). */
export const RANGE: Record<Indicator, [number, number]> = { bmi: [61, 228], hfa: [61, 228], wfa: [61, 120] };

/** L, M, S at an age in months, linearly interpolated between WHO's whole months; null outside the reference. */
export function lmsAt(ind: Indicator, months: number, sex: Sex = 'female'): [number, number, number] | null {
  if (sex !== 'female') return null; // only the girls' tables are bundled
  const t = TABLE[ind], [lo, hi] = RANGE[ind];
  if (months < lo || months > hi) return null;
  const k = Math.min(Math.floor(months) - t.from, t.rows.length - 1), f = months - Math.floor(months);
  const a = t.rows[k], b = t.rows[Math.min(k + 1, t.rows.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const atZ = ([L, M, S]: [number, number, number], z: number) => M * (1 + L * S * z) ** (1 / L);

/**
 * WHO z-score. Height uses the LMS formula directly (L = 1). For weight and BMI, beyond ±3 SD WHO measures in
 * units of the distance between the 2 and 3 SD lines, because the LMS curve stretches the outer tail.
 */
export function zScore(ind: Indicator, value: number, months: number, sex: Sex = 'female'): number | null {
  const lms = lmsAt(ind, months, sex);
  if (!lms || !(value > 0)) return null;
  const [L, M, S] = lms;
  const z = Math.abs(L) < 1e-9 ? Math.log(value / M) / S : ((value / M) ** L - 1) / (S * L);
  if (ind === 'hfa' || Math.abs(z) <= 3) return z;
  if (z > 3) { const sd3 = atZ(lms, 3), sd2 = atZ(lms, 2); return 3 + (value - sd3) / (sd3 - sd2); }
  const sd3 = atZ(lms, -3), sd2 = atZ(lms, -2);
  return -3 + (value - sd3) / (sd2 - sd3);
}
/** The value on a z line at an age (for drawing the reference curves). */
export const valueAtZ = (ind: Indicator, months: number, z: number, sex: Sex = 'female') => { const l = lmsAt(ind, months, sex); return l ? atZ(l, z) : null; };

/** Standard normal cumulative distribution (Abramowitz–Stegun 7.1.26), as a percentile 0–100. */
export function percentile(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 50 * (1 + Math.sign(z) * erf);
}

/** WHO 2007 cut-offs for school-age children: BMI-for-age and height-for-age. Never adult BMI categories. */
export type BmiBand = 'severe_thinness' | 'thinness' | 'normal' | 'overweight' | 'obesity';
export const bmiBand = (z: number): BmiBand => (z < -3 ? 'severe_thinness' : z < -2 ? 'thinness' : z <= 1 ? 'normal' : z <= 2 ? 'overweight' : 'obesity');
export type HeightBand = 'severe_short' | 'short' | 'normal';
export const heightBand = (z: number): HeightBand => (z < -3 ? 'severe_short' : z < -2 ? 'short' : 'normal');

export interface Point { on: string; months: number; weight_kg: number | null; height_cm: number | null; bmi: number | null; z: Partial<Record<Indicator, number | null>> }

/** Each measurement with its age and z-scores. Height carries forward to compute BMI from a later weight (≤ 120 days). */
export function points(list: Measurement[], birth: string, sex: Sex = 'female'): Point[] {
  const sorted = [...list].sort((a, b) => a.on.localeCompare(b.on));
  let lastH: { cm: number; on: string } | null = null;
  return sorted.map((m) => {
    if (m.height_cm) lastH = { cm: m.height_cm, on: m.on };
    const months = ageMonths(birth, m.on);
    const h = lastH && Date.parse(m.on) - Date.parse(lastH.on) <= 120 * DAY ? lastH.cm : null;
    const bmi = m.weight_kg && h ? bmiOf(m.weight_kg, h) : null;
    return {
      on: m.on, months, weight_kg: m.weight_kg, height_cm: m.height_cm, bmi,
      z: { bmi: bmi ? zScore('bmi', bmi, months, sex) : null, hfa: m.height_cm ? zScore('hfa', m.height_cm, months, sex) : null, wfa: m.weight_kg ? zScore('wfa', m.weight_kg, months, sex) : null },
    };
  });
}

/** APP RULES for the trajectory (configurable, documented; not WHO standards). */
export const GROWTH_RULES = {
  trendMinDays: 90,          // a trajectory is judged only across at least 3 months
  zDrop: 0.67,               // a fall of 0.67 z ≈ crossing one major centile line (e.g. 50th → 25th)
  weightLossPct: 3,          // weight lower than 60–365 days earlier by this much
  weightLossMinDays: 60,
  heightStallDays: 180,      // no height gain over 6 months
};

export type GrowthReason = 'bmi_thinness' | 'bmi_obesity' | 'height_short' | 'bmi_z_drop' | 'height_z_drop' | 'weight_down' | 'height_stalled' | 'height_decreased';
export interface GrowthStatus {
  state: 'no_data' | 'baseline' | 'stable' | 'attention';
  reasons: GrowthReason[];
  latest: Point | null;
  change: { d7: number | null; d30: number | null; d90: number | null }; // kg, shown only; never a warning on its own
}

const before = (pts: Point[], on: string, minDays: number, maxDays: number) =>
  pts.filter((p) => p.weight_kg !== null && Date.parse(on) - Date.parse(p.on) >= minDays * DAY && Date.parse(on) - Date.parse(p.on) <= maxDays * DAY);

/** Weight change against the measurement closest to `days` ago (within a quarter of that), for display. */
function changeOver(pts: Point[], latest: Point, days: number): number | null {
  if (latest.weight_kg === null) return null;
  const c = before(pts, latest.on, days * 0.75, days * 1.25).sort((a, b) => Math.abs(Date.parse(latest.on) - Date.parse(a.on) - days * DAY) - Math.abs(Date.parse(latest.on) - Date.parse(b.on) - days * DAY))[0];
  return c ? Math.round((latest.weight_kg - c.weight_kg!) * 10) / 10 : null;
}

/**
 * Is growth progressing normally? Position against WHO cut-offs counts from the first measurement; the trajectory
 * needs measurements at least three months apart. Short-term weight changes are shown, never judged.
 */
export function growthStatus(pts: Point[], R = GROWTH_RULES): GrowthStatus {
  if (!pts.length) return { state: 'no_data', reasons: [], latest: null, change: { d7: null, d30: null, d90: null } };
  const latest = [...pts].reverse().find((p) => p.weight_kg !== null) ?? pts[pts.length - 1];
  const lastH = [...pts].reverse().find((p) => p.height_cm !== null);
  const reasons: GrowthReason[] = [];
  const zb = [...pts].reverse().find((p) => p.z.bmi != null)?.z.bmi ?? null, zh = lastH?.z.hfa ?? null;
  if (zb !== null && zb < -2) reasons.push('bmi_thinness');
  if (zb !== null && zb > 2) reasons.push('bmi_obesity');
  if (zh !== null && zh < -2) reasons.push('height_short');
  const span = Date.parse(pts[pts.length - 1].on) - Date.parse(pts[0].on);
  const trend = span >= R.trendMinDays * DAY;
  if (trend) {
    const year = pts.filter((p) => Date.parse(latest.on) - Date.parse(p.on) <= 365 * DAY);
    const drop = (ind: Indicator) => {
      const withZ = year.filter((p) => p.z[ind] != null);
      if (withZ.length < 2 || Date.parse(withZ[withZ.length - 1].on) - Date.parse(withZ[0].on) < R.trendMinDays * DAY) return false;
      const top = Math.max(...withZ.slice(0, -1).map((p) => p.z[ind]!));
      return top - withZ[withZ.length - 1].z[ind]! >= R.zDrop;
    };
    if (drop('bmi')) reasons.push('bmi_z_drop');
    if (drop('hfa')) reasons.push('height_z_drop');
    if (latest.weight_kg !== null && before(pts, latest.on, R.weightLossMinDays, 365).some((p) => (p.weight_kg! - latest.weight_kg!) / p.weight_kg! * 100 >= R.weightLossPct)) reasons.push('weight_down');
    const hs = pts.filter((p) => p.height_cm !== null);
    if (hs.length >= 2) {
      const last = hs[hs.length - 1], old = hs.filter((p) => Date.parse(last.on) - Date.parse(p.on) >= R.heightStallDays * DAY).pop();
      if (old && last.height_cm! <= old.height_cm!) reasons.push('height_stalled');
    }
  }
  const hs = pts.filter((p) => p.height_cm !== null);
  if (hs.length >= 2 && hs[hs.length - 1].height_cm! < hs[hs.length - 2].height_cm! - 1) reasons.push('height_decreased'); // most likely a typing or measuring error
  const change = { d7: changeOver(pts, latest, 7), d30: changeOver(pts, latest, 30), d90: changeOver(pts, latest, 90) };
  return { state: reasons.length ? 'attention' : trend ? 'stable' : 'baseline', reasons, latest, change };
}

/** Before saving: a change that is more likely a typing error than growth. */
export function implausible(prev: Measurement | null, next: Measurement): ('weight' | 'height')[] {
  if (!prev) return [];
  const days = Math.max(1, (Date.parse(next.on) - Date.parse(prev.on)) / DAY), out: ('weight' | 'height')[] = [];
  if (prev.weight_kg && next.weight_kg && Math.abs(next.weight_kg - prev.weight_kg) > Math.max(1.5, 0.05 * days)) out.push('weight');
  if (prev.height_cm && next.height_cm && (next.height_cm < prev.height_cm - 1 || next.height_cm - prev.height_cm > Math.max(2, 0.04 * days))) out.push('height');
  return out;
}
