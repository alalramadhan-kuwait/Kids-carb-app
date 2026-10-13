// Finger-pricks on the graphs and on home: each prick at its own value beside the sensor's, how this sensor tends to
// read against the finger, and when a prick is worth taking. Information only: nothing here changes a reading,
// an alert or a dose. Pure, tested in Node.

const MIN = 60000;

export interface PrickPoint { t: number; bg: number; libre: number | null; diff: number | null } // diff = libre − finger, mg/dL

/** The sensor reading nearest to each prick (within 7 minutes; otherwise there is nothing to compare with). */
export function prickPoints(pricks: { t: number; bg: number }[], st: ArrayLike<number>, sv: ArrayLike<number>, within = 7 * MIN): PrickPoint[] {
  return pricks.map((p) => {
    let best = -1;
    // the series is sorted: a binary search to the prick's time, then the closer of the two neighbours
    let lo = 0, hi = st.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (st[mid] < p.t) lo = mid + 1; else hi = mid; }
    for (const i of [lo - 1, lo]) if (i >= 0 && i < st.length && Math.abs(st[i] - p.t) <= within && (best < 0 || Math.abs(st[i] - p.t) < Math.abs(st[best] - p.t))) best = i;
    const libre = best < 0 ? null : sv[best];
    return { t: p.t, bg: p.bg, libre, diff: libre === null ? null : libre - p.bg };
  });
}

/** Under this gap (mg/dL) the finger and the sensor count as the same: 0.5 mmol/L. */
export const SAME_MGDL = 9;
export type Gap = 'same' | 'sensor_lower' | 'sensor_higher' | 'none';
export const gapOf = (diff: number | null): Gap => (diff === null ? 'none' : Math.abs(diff) < SAME_MGDL ? 'same' : diff < 0 ? 'sensor_lower' : 'sensor_higher');

export interface BiasRow { sensor_sn: string | null; diff_mgdl: number | null; cause: string; taken_at: string }
export interface SensorBias { gap: Gap; mgdl: number; n: number }
/** Comparisons needed before saying how a sensor reads. */
export const BIAS_MIN = 3;

/** How this sensor reads against the finger: the median difference over its comparisons taken while the reading
 *  was trustworthy (steady or agreeing). Pricks during a fast change, sensor lag or night pressure are left out:
 *  they say what happened at that moment, not how the sensor reads. Null with too few. */
export function sensorBias(rows: BiasRow[], sn: string | null): SensorBias | null {
  if (!sn) return null;
  const d = rows.filter((r) => r.sensor_sn === sn && r.diff_mgdl !== null && (r.cause === 'agrees' || r.cause === 'sensor_bias'))
    .map((r) => r.diff_mgdl!).sort((a, b) => a - b);
  if (d.length < BIAS_MIN) return null;
  const mid = d.length >> 1, med = d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
  return { gap: gapOf(med), mgdl: Math.abs(med), n: d.length };
}

export type PrickHint = 'check_low' | 'night_drop' | null;
/** When a prick is worth taking: the sensor shows a low that is not urgent (the finger tells a real low from a
 *  sensor one), or a fast fall at night (often pressure on the sensor). Never instead of an alert or treatment. */
export function prickHint(p: { v: number | null; at: number | null; rate: number | null; low: number; urgentLow: number; now: number; lastPrick: number | null; night: boolean }): PrickHint {
  if (p.v === null || p.at === null || p.now - p.at > 15 * MIN) return null;
  if (p.lastPrick !== null && p.now - p.lastPrick < 20 * MIN && p.lastPrick <= p.now) return null; // just checked
  if (p.v < p.low && p.v >= p.urgentLow) return 'check_low';
  if (p.night && p.rate !== null && p.rate <= -2 && p.v < p.low + 36) return 'night_drop';
  return null;
}

/** Inside the parents' night hours ("HH:MM", Kuwait time; the window may cross midnight). */
export function inNight(now: number, night: { start: string; end: string }): boolean {
  const m = Math.floor(((now + 3 * 3600000) % 86400000) / MIN);
  const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const a = hm(night.start), b = hm(night.end);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}
