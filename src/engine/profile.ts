// Patterns / AGP (GLUCOSE_PLAN 11.9). Pure helpers around carb.glucose_profile.
export interface Bin { bin: number; days: number; n: number; p10: number; p25: number; p50: number; p75: number; p90: number }
export const MIN_DAYS = 5; // a bin with fewer days is drawn hollow ("not enough data")

/** Day filters: all, school days (from the school profile), weekend (the other days), or chosen weekdays. */
export type DayFilter = 'all' | 'school' | 'weekend' | 'custom';
export function daysFor(f: DayFilter, schoolDays: number[], custom: number[]): number[] | null {
  if (f === 'all') return null;
  const school = schoolDays.length ? schoolDays : [0, 1, 2, 3, 4];
  if (f === 'school') return school;
  if (f === 'weekend') return [0, 1, 2, 3, 4, 5, 6].filter((d) => !school.includes(d));
  return custom.length ? custom : null;
}

/** Runs of consecutive bins that have enough days, so the bands are drawn only where they are meaningful. */
export function solidRuns(bins: Bin[], binMin = 15): Bin[][] {
  const runs: Bin[][] = [];
  let cur: Bin[] = [];
  for (const b of bins) {
    const ok = b.days >= MIN_DAYS;
    if (ok && cur.length && b.bin === cur[cur.length - 1].bin + 1) cur.push(b);
    else { if (cur.length) runs.push(cur); cur = ok ? [b] : []; }
  }
  if (cur.length) runs.push(cur);
  void binMin;
  return runs;
}
