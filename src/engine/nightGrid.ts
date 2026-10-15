// The hours she sleeps, 00:00–07:00 (Kuwait), night by night: the lowest reading in each 15 minutes, the treatments and
// the finger-pricks, when glucose first went under the low line, and how many nights did so on each Tresiba dose.
// Read only and pure. It describes the sensor as it read: nothing is corrected, dropped or called false, and a juice is
// a safety action, never read as Tresiba failing. It never proposes a dose.
import { NT, type NightReport } from './nightTresiba';
import { dayStartOf } from './day';
import type { Series } from './series';
import type { EventRow } from '../lib/types';

const MIN = 60000, H = 3600000;
export const NG = { fromH: 24, toH: 31, binMin: 15 } as const; // hours after the evening's day start: 00:00–07:00

export interface GridPrick { t: number; bg: number; libre: number | null }
export interface GridNight {
  day: number; from: number; to: number; units: number | null; settling: boolean;
  bins: (number | null)[];          // the lowest reading in each 15 minutes, null where there is none
  juices: number[]; pricks: GridPrick[];
  min: number | null; minAt: number | null;
  firstLow: number | null;          // the first reading under the low line (3.9)
  prickBefore: boolean | null;      // every first treatment had a finger-prick before it; null: no treatment
}
export interface DoseLows { units: number; nights: number; low: number }
export interface Grid { nights: GridNight[]; onset: number[]; byDose: DoseLows[] }

const lowestIn = (s: Series, a: number, b: number) => {
  let m: number | null = null, at: number | null = null;
  for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] < b && (m === null || s.v[i] < m)) { m = s.v[i]; at = s.t[i]; }
  return { m, at };
};

/** The finished nights of the report (the last `last` of them), oldest first, each cut to 00:00–07:00. */
export function nightGrid(report: NightReport, series: Series, last = Infinity): Grid {
  const nights: GridNight[] = [...report.nights].slice(0, last).reverse().map((n) => {
    const from = n.day + NG.fromH * H, to = n.day + NG.toH * H;
    const bins: (number | null)[] = [];
    for (let b = from; b < to; b += NG.binMin * MIN) bins.push(lowestIn(series, b, b + NG.binMin * MIN).m);
    const { m, at } = lowestIn(series, from, to);
    let firstLow: number | null = null;
    for (let i = 0; i < series.t.length; i++) if (series.t[i] >= from && series.t[i] < to && series.v[i] < NT.lowMg) { firstLow = series.t[i]; break; }
    const eps = n.episodes.filter((e) => e.t >= from && e.t < to);
    return {
      day: n.day, from, to, units: n.dose?.units ?? null, settling: n.settling, bins,
      juices: eps.flatMap((e) => e.juices.map((j) => j.t)),
      pricks: n.pricks.filter((p) => p.t >= from && p.t < to).map((p) => ({ t: p.t, bg: p.bg, libre: p.libre })),
      min: m, minAt: at, firstLow, prickBefore: eps.length ? eps.every((e) => !!e.prick && !e.prick.after) : null,
    };
  });
  const onset = Array.from({ length: NG.toH - NG.fromH }, () => 0);
  for (const n of nights) if (n.firstLow !== null) onset[Math.min(onset.length - 1, Math.floor((n.firstLow - n.from) / H))]++;
  const byDose: DoseLows[] = [];
  for (const n of nights) {
    if (n.units === null) continue;
    const last = byDose[byDose.length - 1];
    const g = last && last.units === n.units ? last : (byDose.push({ units: n.units, nights: 0, low: 0 }), byDose[byDose.length - 1]);
    g.nights++; if (n.firstLow !== null) g.low++;
  }
  return { nights, onset, byDose };
}

export interface LastNight { from: number; to: number; min: number | null; minAt: number | null; firstLow: number | null; juices: number; prickBefore: boolean | null; units: number | null }

/** Last night's 00:00–07:00 for the home screen, from the readings at hand and the treatments as logged. Shown from 07:00
 *  to 13:00 only; null outside those hours or without readings. */
export function lastNight(s: Series, events: EventRow[], now: number): LastNight | null {
  const from = dayStartOf(now), to = from + 7 * H;
  if (now < to || now >= from + 13 * H) return null;
  const { m, at } = lowestIn(s, from, to);
  if (m === null) return null;
  let firstLow: number | null = null;
  for (let i = 0; i < s.t.length; i++) if (s.t[i] >= from && s.t[i] < to && s.v[i] < NT.lowMg) { firstLow = s.t[i]; break; }
  const live = events.filter((e) => !e.deleted_at);
  const at_ = (e: EventRow) => Date.parse(e.occurred_at);
  const treats = live.filter((e) => e.kind === 'treatment' && at_(e) >= from && at_(e) < to).map(at_).sort((a, b) => a - b);
  const pricks = live.filter((e) => e.kind === 'bg_check' && e.bg_mgdl).map(at_);
  // first treatments only: a juice within 45 minutes of the last is the 15-minute-rule repeat of the same episode
  const firsts = treats.filter((x, i) => i === 0 || x - treats[i - 1] > NT.episodeMin * MIN);
  const dose = live.filter((e) => e.kind === 'insulin' && e.insulin_type === 'long' && e.insulin_units && at_(e) < from && from - at_(e) < 30 * H)
    .sort((a, b) => at_(b) - at_(a))[0];
  return {
    from, to, min: m, minAt: at, firstLow, juices: treats.length,
    prickBefore: firsts.length ? firsts.every((j) => pricks.some((p) => p >= j - NT.prickBeforeMin * MIN && p <= j + NT.prickAfterMin * MIN)) : null,
    units: dose ? Number(dose.insulin_units) : null,
  };
}
