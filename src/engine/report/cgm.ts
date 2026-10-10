// Clinical report engine, part 1: CGM readings as time. Pure functions only, for the doctor reports (not the live
// screens, alerts or dose calculations, which keep their own code).
//
// The stored readings are never changed. The table mixes minute readings (LibreLinkUp live), 15-minute history
// points and 5-minute Gluroo imports, so every statistic is weighted by time, not by count:
//  • a reading stands for the time from its timestamp until the next reading, at most 15 minutes (a longer gap
//    is missing data, never filled in);
//  • for charts and events the same time line is cut into 5-minute slots; a slot counts as measured when at least
//    half of it (2.5 minutes) is covered, and its value is the time-weighted mean inside it.
// Times are epoch milliseconds; days are Kuwait days (UTC+3 all year, no daylight saving).

export const MIN = 60000, DAY = 86400000, KW = 3 * 3600000;
export const HOLD_MIN = 15;
/** History points arrive a few seconds over 15 minutes apart (Gluroo's export: 15.1): up to 1 minute more is jitter, not a gap. */
export const JITTER_MIN = 1;
export const SLOT_MIN = 5;
const SLOT = SLOT_MIN * MIN;

export interface Reading { t: number; mg: number }
export interface Segment { a: number; b: number; mg: number }
export interface Slot { t: number; mg: number | null; cover: number /* minutes measured, 0–5 */ }

/** Kuwait midnight at or before t. */
export const kwDayStart = (t: number) => Math.floor((t + KW) / DAY) * DAY - KW;
/** "2026-10-10" for the Kuwait day of t. */
export const kwDayKey = (t: number) => new Date(t + KW).toISOString().slice(0, 10);
/** Minutes after Kuwait midnight. */
export const kwMinuteOfDay = (t: number) => Math.floor(((t + KW) % DAY + DAY) % DAY / MIN);

/** Sorted copy without unusable rows; the caller's array is left as it is. Equal timestamps keep the first. */
export function clean(rs: Reading[]): Reading[] {
  const out = rs.filter((r) => Number.isFinite(r.t) && Number.isFinite(r.mg) && r.mg >= 10 && r.mg <= 900).slice().sort((x, y) => x.t - y.t);
  return out.filter((r, i) => i === 0 || r.t !== out[i - 1].t);
}

/** The time line: each reading from its time until the next one, at most HOLD_MIN, clipped to [from, to). */
export function segments(rs: Reading[], from: number, to: number, holdMin = HOLD_MIN): Segment[] {
  const s = clean(rs), out: Segment[] = [];
  for (let i = 0; i < s.length; i++) {
    const next = i + 1 < s.length ? s[i + 1].t : Infinity;
    const a = Math.max(s[i].t, from), b = Math.min(next, s[i].t + holdMin * MIN, to);
    if (b > a) out.push({ a, b, mg: s[i].mg });
  }
  return out;
}

/** The time line for EVENTS: as `segments`, except that the last reading before missing data (or the end) lasts only
 *  its own reading interval (1 minute for live readings, 15 for history points), not a full 15 minutes, so one low
 *  reading followed by a sensor drop-out is not counted as 15 minutes low. Readings up to 16 minutes apart are
 *  continuous (JITTER_MIN). */
export function eventSegments(rs: Reading[], from: number, to: number, holdMin = HOLD_MIN): Segment[] {
  const s = clean(rs), out: Segment[] = [], hold = holdMin * MIN;
  for (let i = 0; i < s.length; i++) {
    const next = i + 1 < s.length ? s[i + 1].t : Infinity;
    const own = i > 0 ? Math.min(hold, Math.max(MIN, s[i].t - s[i - 1].t)) : MIN;
    const until = next - s[i].t <= hold + JITTER_MIN * MIN ? next : s[i].t + own;
    const a = Math.max(s[i].t, from), b = Math.min(until, to);
    if (b > a) out.push({ a, b, mg: s[i].mg });
  }
  return out;
}

/** 5-minute slots from `from` (rounded down to a slot edge) to `to`. A slot with under half its time measured has
 *  no value: it is shown as missing, never guessed. */
export function grid(rs: Reading[], from: number, to: number): Slot[] {
  const start = Math.floor(from / SLOT) * SLOT, n = Math.max(0, Math.ceil((to - start) / SLOT));
  const sum = new Float64Array(n), dur = new Float64Array(n);
  for (const g of segments(rs, start, to)) {
    for (let k = Math.floor((g.a - start) / SLOT); k < n; k++) {
      const s0 = start + k * SLOT, s1 = s0 + SLOT;
      if (s0 >= g.b) break;
      const d = Math.min(g.b, s1) - Math.max(g.a, s0);
      if (d > 0) { sum[k] += g.mg * d; dur[k] += d; }
    }
  }
  const out: Slot[] = [];
  for (let k = 0; k < n; k++) out.push({ t: start + k * SLOT, mg: dur[k] >= SLOT / 2 ? sum[k] / dur[k] : null, cover: dur[k] / MIN });
  return out;
}
