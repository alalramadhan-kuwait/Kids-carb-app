// Clinical report engine, part 3: the Ambulatory Glucose Profile (AGP). All days are laid over one 24-hour clock
// (Kuwait time) and, at every 5 minutes of the day, the 5th, 25th, 50th (median), 75th and 95th percentiles are
// taken, as in the standard AGP (International Diabetes Center; Battelino 2019).
// Each measured 5-minute slot is one value (so a period of minute readings and a period of 15-minute points weigh
// the same per hour). Light smoothing: each point pools the slots within ±15 minutes of it (7 slots, wrapping round
// midnight). A point resting on fewer than 5 different days is marked thin.
import { DAY, KW, MIN, SLOT_MIN, grid, kwDayKey, type Reading } from './cgm';

export const AGP_PCTS = [5, 25, 50, 75, 95] as const;
export const AGP_POOL = 3; // slots either side (±15 min)
export const AGP_MIN_DAYS = 5;
const PER_DAY = (24 * 60) / SLOT_MIN; // 288

export interface AgpPoint { minute: number; p5: number; p25: number; p50: number; p75: number; p95: number; n: number; days: number; thin: boolean }

/** Percentile with linear interpolation between ranks (Hyndman–Fan type 7, as in Excel PERCENTILE.INC and R). */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * (p / 100), lo = Math.floor(h), hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function agp(rs: Reading[], from: number, to: number): (AgpPoint | null)[] {
  const bins: { v: number; day: string }[][] = Array.from({ length: PER_DAY }, () => []);
  for (const s of grid(rs, from, to)) {
    if (s.mg === null) continue;
    const k = Math.floor((((s.t + KW) % DAY) + DAY) % DAY / (SLOT_MIN * MIN));
    bins[k].push({ v: s.mg, day: kwDayKey(s.t) });
  }
  const out: (AgpPoint | null)[] = [];
  for (let k = 0; k < PER_DAY; k++) {
    const pool: number[] = [], days = new Set<string>();
    for (let j = -AGP_POOL; j <= AGP_POOL; j++) for (const x of bins[(k + j + PER_DAY) % PER_DAY]) { pool.push(x.v); days.add(x.day); }
    if (!pool.length) { out.push(null); continue; }
    pool.sort((a, b) => a - b);
    const q = (p: number) => percentile(pool, p);
    out.push({ minute: k * SLOT_MIN, p5: q(5), p25: q(25), p50: q(50), p75: q(75), p95: q(95), n: pool.length, days: days.size, thin: days.size < AGP_MIN_DAYS });
  }
  return out;
}
