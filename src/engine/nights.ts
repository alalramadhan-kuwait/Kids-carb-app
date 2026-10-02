// Nights for the clinic report. Pure, tested in Node: for each night (the parents' night hours, Kuwait time), the
// lowest reading, the minutes below the low line and the low treatments logged. Describes; never advises a dose.
const MIN = 60000, DAY = 86400000, KW = 3 * 3600000;

export interface NightRow { start: number; end: number; min: number | null; minutesBelow: number; treatments: number; coverage: number }
const toMin = (hhmm: string | null, dflt: number) => { if (!hhmm) return dflt; const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

/** Nights starting on each Kuwait day in [from, to); a reading counts until the next one, up to 15 minutes. */
export function nightRows(t: ArrayLike<number>, v: ArrayLike<number>, treatments: number[], from: number, to: number,
  nightStart: string | null, nightEnd: string | null, low = 70): NightRow[] {
  const a = toMin(nightStart, 22 * 60), b = toMin(nightEnd, 6 * 60);
  const out: NightRow[] = [];
  for (let day = Math.floor((from + KW) / DAY) * DAY - KW; day < to; day += DAY) {
    const start = day + a * MIN, end = (b > a ? day : day + DAY) + b * MIN;
    if (end > to + DAY || start < from) continue;
    let mn: number | null = null, below = 0, seen = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < start || t[i] >= end) continue;
      const span = Math.min(15 * MIN, (i + 1 < t.length ? t[i + 1] : t[i] + 5 * MIN) - t[i], end - t[i]);
      seen += span;
      if (mn === null || v[i] < mn) mn = v[i];
      if (v[i] < low) below += span;
    }
    if (!seen) continue;
    out.push({ start, end, min: mn, minutesBelow: Math.round(below / MIN), treatments: treatments.filter((x) => x >= start && x < end).length, coverage: seen / (end - start) });
  }
  return out;
}
