// The same time-weighted statistics as carb.glucose_stats, computed on a loaded series so any set of days can be
// compared (e.g. school days vs weekend). Each reading counts until the next one, at most 15 minutes, never past
// the period end. Bands are the international reporting bands (mg/dL).
import { lowerBound, type Series } from './series';

const MIN = 60000, KW = 3 * 60 * MIN, DAY = 1440 * MIN;
export interface PeriodStats {
  n: number; coverage: number; mean: number | null; sd: number | null; cv: number | null; min: number | null; max: number | null;
  pct_vlow: number; pct_low: number; pct_in: number; pct_high: number; pct_vhigh: number;
}
const dowOf = (t: number) => new Date(t + KW).getUTCDay();

export function seriesStats(s: Series, from: number, to: number, now = Date.now(), dows: number[] | null = null): PeriodStats {
  const end = Math.min(to, now);
  let tot = 0, sum = 0, n = 0, mn = Infinity, mx = -Infinity;
  const band = [0, 0, 0, 0, 0];
  const w: [number, number][] = [];
  for (let i = lowerBound(s.t, from); i < s.t.length && s.t[i] < to; i++) {
    if (dows && !dows.includes(dowOf(s.t[i]))) continue;
    const next = i + 1 < s.t.length ? s.t[i + 1] : end;
    const mins = Math.max(0, (Math.min(next, s.t[i] + 15 * MIN, end) - s.t[i]) / MIN);
    const v = s.v[i];
    n++; tot += mins; sum += v * mins; mn = Math.min(mn, v); mx = Math.max(mx, v); w.push([v, mins]);
    band[v < 54 ? 0 : v < 70 ? 1 : v <= 180 ? 2 : v <= 250 ? 3 : 4] += mins;
  }
  // the period the stats are measured against: only the chosen weekdays count
  let period = 0;
  if (dows) { for (let d = Math.floor((from + KW) / DAY) * DAY - KW; d < end; d += DAY) if (dows.includes(dowOf(d))) period += Math.max(0, Math.min(d + DAY, end) - Math.max(d, from)); }
  else period = Math.max(0, end - from);
  const mean = tot ? sum / tot : null;
  const sd = mean === null ? null : Math.sqrt(w.reduce((a, [v, m]) => a + m * (v - mean) ** 2, 0) / tot);
  const pct = (x: number) => (tot ? Math.round((1000 * x) / tot) / 10 : 0);
  const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
  return {
    n, coverage: period ? Math.round((1000 * tot) / (period / MIN)) / 10 : 0, mean: r1(mean), sd: r1(sd),
    cv: mean && sd !== null ? Math.round((1000 * sd) / mean) / 10 : null, min: n ? mn : null, max: n ? mx : null,
    pct_vlow: pct(band[0]), pct_low: pct(band[1]), pct_in: pct(band[2]), pct_high: pct(band[3]), pct_vhigh: pct(band[4]),
  };
}
