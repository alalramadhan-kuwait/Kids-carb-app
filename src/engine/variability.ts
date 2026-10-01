// Variability and risk indices (GLUCOSE_PLAN 10.11, stage 11). Pure, tested in Node. Analytical numbers for
// discussion with the care team: each one is a published formula, computed on a 15-minute grid so 1-minute live
// readings and 15-minute history weigh the same, and never joined across a gap.
import { dayStartOf } from './day';
import type { Series } from './series';
import { t } from '../i18n';

const MIN = 60000, STEP = 15 * MIN, DAY = 24 * 60 * MIN;

/** One value per 15-minute slot: the reading nearest the slot time within half a slot, else NaN (a gap). */
export function grid(s: Series, start: number, end: number): { t0: number; v: Float64Array } {
  const t0 = Math.ceil(start / STEP) * STEP, n = Math.max(0, Math.ceil((end - t0) / STEP)); // slots in [start, end)
  const v = new Float64Array(n).fill(NaN), d = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < s.t.length; i++) {
    const k = Math.round((s.t[i] - t0) / STEP);
    if (k < 0 || k >= n) continue;
    const dist = Math.abs(s.t[i] - (t0 + k * STEP));
    if (dist <= STEP / 2 && dist < d[k]) { d[k] = dist; v[k] = s.v[i]; }
  }
  return { t0, v };
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a: number[]) => { const m = mean(a); return m === null || a.length < 2 ? null : Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

/** CONGA(n): SD of the differences between each value and the one n hours earlier (McDonnell 2005). */
export function conga(v: Float64Array, hours = 1): number | null {
  const lag = (hours * 60 * MIN) / STEP, d: number[] = [];
  for (let k = lag; k < v.length; k++) if (!isNaN(v[k]) && !isNaN(v[k - lag])) d.push(v[k] - v[k - lag]);
  return d.length >= 8 ? sd(d) : null;
}

/** MODD: mean absolute difference between values at the same time on consecutive days (Molnar 1972).
 *  Needs paired values for at least 70 % of the slots that have a slot a day earlier. */
export function modd(v: Float64Array): number | null {
  const lag = DAY / STEP, d: number[] = [];
  for (let k = lag; k < v.length; k++) if (!isNaN(v[k]) && !isNaN(v[k - lag])) d.push(Math.abs(v[k] - v[k - lag]));
  return v.length > lag && d.length >= 0.7 * (v.length - lag) ? mean(d) : null;
}

/**
 * MAGE (Service 1970): mean amplitude of the swings larger than one SD. Peaks and nadirs are found in each
 * continuous run; a swing smaller than one SD is removed with its pair so the extremes keep alternating.
 * This averages swings in both directions (the "average" variant), stated under the number.
 */
export function mage(v: Float64Array): number | null {
  const all: number[] = []; for (const x of v) if (!isNaN(x)) all.push(x);
  const s = sd(all); if (s === null || all.length < 12) return null;
  if (s === 0) return 0;
  const amps: number[] = [];
  let k = 0;
  while (k < v.length) {
    while (k < v.length && isNaN(v[k])) k++;
    const run: number[] = []; while (k < v.length && !isNaN(v[k])) run.push(v[k++]);
    if (run.length < 3) continue;
    const ext: number[] = [run[0]];
    for (let i = 1; i < run.length - 1; i++) {
      const up = run[i] - run[i - 1], down = run[i + 1] - run[i];
      if ((up > 0 && down <= 0) || (up < 0 && down >= 0)) ext.push(run[i]);
    }
    ext.push(run[run.length - 1]);
    // keep strict alternation: drop a middle point that continues the same direction
    for (let i = 1; i < ext.length - 1;) { if ((ext[i] - ext[i - 1]) * (ext[i + 1] - ext[i]) >= 0) ext.splice(i, 1); else i++; }
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 1; i < ext.length - 1; i++) if (Math.abs(ext[i + 1] - ext[i]) < s && i + 1 < ext.length - 1) { ext.splice(i, 2); changed = true; break; }
      for (let i = 1; i < ext.length - 1;) { if ((ext[i] - ext[i - 1]) * (ext[i + 1] - ext[i]) >= 0) { ext.splice(i, 1); changed = true; } else i++; }
    }
    for (let i = 1; i < ext.length; i++) { const a = Math.abs(ext[i] - ext[i - 1]); if (a >= s) amps.push(a); }
  }
  return amps.length ? mean(amps) : 0;
}

/** Kovatchev's symmetrised risk: f < 0 below 112.5 mg/dL, f > 0 above; risk = 10 f². */
export const riskF = (g: number) => 1.509 * (Math.pow(Math.log(Math.max(20, Math.min(600, g))), 1.084) - 5.381);

export function riskIndices(v: Float64Array, t0: number): { lbgi: number; hbgi: number; adrr: number | null; days: number } | null {
  const rl: number[] = [], rh: number[] = [];
  const perDay = new Map<number, { lo: number; hi: number; n: number }>();
  for (let k = 0; k < v.length; k++) {
    if (isNaN(v[k])) continue;
    const f = riskF(v[k]), r = 10 * f * f;
    const lo = f < 0 ? r : 0, hi = f > 0 ? r : 0;
    rl.push(lo); rh.push(hi);
    const day = dayStartOf(t0 + k * STEP), d = perDay.get(day) ?? { lo: 0, hi: 0, n: 0 };
    d.lo = Math.max(d.lo, lo); d.hi = Math.max(d.hi, hi); d.n++; perDay.set(day, d);
  }
  if (rl.length < 12) return null;
  const full = [...perDay.values()].filter((d) => d.n >= 48); // at least half a day of slots
  return { lbgi: mean(rl)!, hbgi: mean(rh)!, adrr: full.length ? mean(full.map((d) => d.lo + d.hi)) : null, days: full.length };
}

export interface Variability {
  mage: number | null; modd: number | null; conga1: number | null; conga2: number | null; conga4: number | null;
  lbgi: number | null; hbgi: number | null; adrr: number | null;
  days: number;        // days of data (15-minute slots with a reading ÷ 96)
  fullDays: number;    // days with at least half their slots, used by ADRR
}

/** Minimum data per measure (GLUCOSE_PLAN 10.10); below it the value is hidden, not shown faintly. */
export const MIN_DAYS = { mage: 7, modd: 2, conga: 1, risk: 1, adrr: 14 } as const;

export function variability(s: Series, start: number, end: number): Variability {
  const { t0, v } = grid(s, start, end);
  let slots = 0; for (const x of v) if (!isNaN(x)) slots++;
  const days = slots / 96;
  const r = riskIndices(v, t0);
  const ok = (need: number) => days >= need;
  return {
    mage: ok(MIN_DAYS.mage) ? mage(v) : null,
    modd: ok(MIN_DAYS.modd) ? modd(v) : null,
    conga1: ok(MIN_DAYS.conga) ? conga(v, 1) : null, conga2: ok(MIN_DAYS.conga) ? conga(v, 2) : null, conga4: ok(MIN_DAYS.conga) ? conga(v, 4) : null,
    lbgi: ok(MIN_DAYS.risk) ? r?.lbgi ?? null : null, hbgi: ok(MIN_DAYS.risk) ? r?.hbgi ?? null : null,
    adrr: r && r.days >= MIN_DAYS.adrr ? r.adrr : null,
    days: Math.round(days * 10) / 10, fullDays: r?.days ?? 0,
  };
}

/** Published risk bands (Kovatchev): words only, no colour of their own. */
export const lbgiBand = (x: number) => (x < 1.1 ? t('ضئيل') : x <= 2.5 ? t('منخفض') : x <= 5 ? t('متوسط') : t('مرتفع'));
export const hbgiBand = (x: number) => (x < 5 ? t('منخفض') : x <= 10 ? t('متوسط') : t('مرتفع'));
export const adrrBand = (x: number) => (x < 20 ? t('منخفض') : x <= 40 ? t('متوسط') : t('مرتفع'));
