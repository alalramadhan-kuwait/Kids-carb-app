// Stretches when only the long-acting insulin was working: no rapid insulin for hours, nothing eaten for hours. What
// her glucose does then is the long-acting insulin's own picture (with her liver and the time of day). Pure, tested in
// Node. It describes; it never proposes a dose or a time.
import type { Series } from './series';

const MIN = 60000, H = 3600000;

export interface BasalRules {
  rapid_gap_min: number;   // no rapid insulin for this long before (any model counts it as gone by then)
  food_gap_min: number;    // nothing eaten (food, carbs, hypo treatment ≥ small_food_g) for this long before
  min_len_min: number;     // a stretch shorter than this is not shown
  fall_mgdl_h: number;     // a fall this fast (per hour) is counted as "falling"
}
export const BASAL_DEFAULTS: BasalRules = { rapid_gap_min: 360, food_gap_min: 180, min_len_min: 60, fall_mgdl_h: 18 };

export interface Mark { t: number; kind: 'food' | 'treatment' | 'rapid' }
export interface Stretch {
  from: number; to: number;
  start: number; end: number; min: number;
  rate: number;                    // mg/dL per hour (least squares over the stretch)
  low: boolean;                    // went below the range
  endedBy: Mark['kind'] | 'data';  // what came next
  sinceRapidMin: number | null;    // from the last rapid dose to the start
  long: { t: number; units: number | null } | null; // the last long-acting dose before it
}

/** All stretches in [from, to) when only the long-acting insulin was working. */
export function basalStretches(s: Series, marks: Mark[], long: { t: number; units: number | null }[], low: number, from: number, to: number, r: BasalRules = BASAL_DEFAULTS): Stretch[] {
  const ms = [...marks].sort((a, b) => a.t - b.t);
  const rapid = ms.filter((m) => m.kind === 'rapid').map((m) => m.t);
  const eat = ms.filter((m) => m.kind !== 'rapid').map((m) => m.t);
  const longs = [...long].sort((a, b) => a.t - b.t);
  const lastBefore = (xs: number[], t: number) => { let v: number | null = null; for (const x of xs) { if (x <= t) v = x; else break; } return v; };
  // only while the log is being kept: a long-acting dose within the last 30 hours
  const ok = (t: number) => {
    const lr = lastBefore(rapid, t), le = lastBefore(eat, t), ll = lastBefore(longs.map((x) => x.t), t);
    return ll !== null && t - ll <= 30 * H && (lr === null || t - lr >= r.rapid_gap_min * MIN) && (le === null || t - le >= r.food_gap_min * MIN);
  };
  const out: Stretch[] = [];
  let run: number[] = [];
  const close = () => {
    if (run.length >= 2) {
      const a = s.t[run[0]], b = s.t[run[run.length - 1]];
      if (b - a >= r.min_len_min * MIN) {
        const xs = run.map((i) => (s.t[i] - a) / H), ys = run.map((i) => s.v[i]);
        const mx = xs.reduce((p, x) => p + x, 0) / xs.length, my = ys.reduce((p, y) => p + y, 0) / ys.length;
        const sxx = xs.reduce((p, x) => p + (x - mx) ** 2, 0);
        const rate = sxx ? xs.reduce((p, x, k) => p + (x - mx) * (ys[k] - my), 0) / sxx : 0;
        const next = ms.find((m) => m.t > b && m.t <= b + 30 * MIN);
        const lr = lastBefore(rapid, a);
        let lg: Stretch['long'] = null;
        for (const x of longs) { if (x.t <= b) lg = x; else break; }
        out.push({
          from: a, to: b, start: ys[0], end: ys[ys.length - 1], min: Math.min(...ys), rate: Math.round(rate * 10) / 10,
          low: ys.some((y) => y < low), endedBy: next ? next.kind : 'data', sinceRapidMin: lr === null ? null : Math.round((a - lr) / MIN), long: lg,
        });
      }
    }
    run = [];
  };
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i];
    if (t < from || t >= to) continue;
    if (run.length && t - s.t[run[run.length - 1]] > 20 * MIN) close();
    if (ok(t)) run.push(i); else close();
  }
  close();
  return out;
}

/** Overlaps the night window (minutes of the local clock): a fall that starts in the evening or runs past morning counts. */
export const atNight = (st: Stretch, clockMin: (t: number) => number, start: string, end: string) => {
  const a = toMin(start), b = toMin(end);
  const inside = (m: number) => (a <= b ? m >= a && m < b : m >= a || m < b);
  for (let t = st.from; t <= st.to; t += 15 * MIN) if (inside(clockMin(t))) return true;
  return inside(clockMin(st.to));
};
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); };

export interface BasalSummary { n: number; nights: number; falling: number; low: number; treated: number; rate: number | null; drop: number | null }
export function basalSummary(list: Stretch[], r: BasalRules, dayOf: (t: number) => string): BasalSummary {
  const rates = list.map((x) => x.rate).sort((a, b) => a - b);
  const drops = list.map((x) => x.start - x.end).sort((a, b) => a - b);
  const mid = (xs: number[]) => (xs.length ? (xs.length % 2 ? xs[xs.length >> 1] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null);
  return {
    n: list.length, nights: new Set(list.map((x) => dayOf(x.from))).size,
    falling: list.filter((x) => x.rate <= -r.fall_mgdl_h).length, low: list.filter((x) => x.low).length,
    treated: list.filter((x) => x.endedBy === 'treatment').length, rate: mid(rates), drop: mid(drops),
  };
}
