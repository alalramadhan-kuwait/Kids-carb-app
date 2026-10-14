// Analysis → Night: what her glucose does overnight on each Tresiba dose. Read only, pure, tested in Node. It reuses the
// long-acting-only stretches (basal.ts), the night rows (nights.ts), the day totals (day.ts) and the finger-prick pairing
// (prick.ts) the other pages use; it adds only the sorting of nights and the grouping by dose.
//
// It describes. It never proposes a dose, never says the long-acting dose is too much or too little, never changes or
// drops a sensor reading (a questioned reading is only left out of the rate of fall; its low still counts), and never
// guesses where glucose would have gone without a treatment.
import { basalMarks, basalStretches, BASAL_DEFAULTS, type Stretch } from './basal';
import { nightRows } from './nights';
import { dayStartOf, dayTotals } from './day';
import { prickPoints } from './prick';
import { agreesWith } from './fingerprick';
import { stat, type Confidence, type Stat } from './doctorCheck';
import { entriesFrom } from './predict';
import type { Series } from './series';
import type { EventRow, HistoryEntry } from '../lib/types';

const MIN = 60000, H = 3600000, DAY = 86400000;

export const NT = {
  evening: '21:00', morning: '07:00',  // the night (Kuwait time)
  coreFromH: 24, coreToH: 30,          // the rate is measured 00:00–06:00 (hours after the evening's day start)
  settle: 3,                           // nights 1–3 on a new dose are "settling" (Tresiba takes 3–4 days to level)
  cleanMin: 180,                       // a clean night has at least 3 hours of long-acting-only readings in 00:00–06:00
  coverage: 0.7,                       // less than this share of 00:00–06:00 with readings = missing data
  fastFall: 3,                         // mg/dL per minute over 10–20 minutes: faster than glucose usually falls
  vDrop: 30, vBeforeMin: 30, vAfterMin: 45, // a dip of 30 mg/dL that comes back within 45 minutes, nothing eaten
  doubtBelow: 90,                      // only dips that reach this low are questioned (wiggles high up do not change a low)
  prickMin: 45,                        // readings this close to a finger-prick that disagrees are questioned
  juiceLookMin: 45, juiceFall: 12,     // falling 12 mg/dL or more in the 45 minutes before a treatment
  fewN: 3, lowN: 7,                    // clean nights: under 3 too few; under 7 low confidence
  lowMg: 70, veryLowMg: 54,
} as const;

export type NightClass = 'clean' | 'insulin_food' | 'juice' | 'sensor';
export const CLASSES: NightClass[] = ['clean', 'insulin_food', 'juice', 'sensor'];
export type Doubt = 'fast_fall' | 'v_shape' | 'prick' | 'gaps';

export interface DoseRow { t: number; units: number; nth: number; prev: number | null } // nth: 1st, 2nd… dose at these units
export interface Treatment { t: number; grams: number; name: string | null; at: number | null; fallBefore: number | null; interrupted: boolean; peakAfter: number | null }
export interface Prick { t: number; bg: number; libre: number | null; diff: number | null; agrees: boolean | null }
export interface Night {
  day: number; start: number; end: number; coreFrom: number; coreTo: number;
  dose: DoseRow | null; settling: boolean;
  cls: NightClass; tags: { rapid: number | null; food: number | null; juice: boolean; sensor: Doubt[] }; // rapid/food: when, if within reach of 00:00–06:00
  min: number | null; lowAt: number | null; minQuestioned: boolean; below70: number; below54: number; coverage: number;
  rate: number | null; rateMin: number; rateStart: number | null; sinceRapidMin: number | null; stretches: Stretch[];
  treatments: Treatment[]; pricks: Prick[]; questioned: { from: number; to: number; why: Doubt }[];
}
/** rates: clean nights only. periods: every long-acting-only stretch of an hour or more in 00:00–06:00, from any night but
 *  the questioned-sensor ones, including the fall before a juice (so it leans towards falls; descriptive only). */
export interface DoseGroup { units: number; settling: boolean; nights: number; clean: number; rates: Stat; range: [number, number] | null; conf: Confidence; periods: Stat; low: number; juice: number }
export interface DayRow { day: number; units: number | null; long: number; rapid: number; total: number; carbs: number; juices: number; juiceG: number }
export interface DayGroup { units: number; days: number; long: number; rapid: number; total: number; carbs: number; juices: number }
export interface NightReport { from: number; to: number; doses: DoseRow[]; nights: Night[]; groups: DoseGroup[]; days: DayRow[]; dayGroups: DayGroup[] }

export interface NightInputs { series: Series; history: HistoryEntry[]; events: EventRow[]; from: number; now: number }

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Index of the reading nearest t (within `within`), or -1. The series is sorted. */
function near(t: ArrayLike<number>, at: number, within = 7 * MIN) {
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < at) lo = m + 1; else hi = m; }
  let best = -1;
  for (const i of [lo - 1, lo]) if (i >= 0 && i < t.length && Math.abs(t[i] - at) <= within && (best < 0 || Math.abs(t[i] - at) < Math.abs(t[best] - at))) best = i;
  return best;
}

/** Long-acting doses, oldest first, each with how many in a row at the same units. */
export function doseRows(events: EventRow[]): DoseRow[] {
  const xs = events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type === 'long' && e.insulin_units)
    .map((e) => ({ t: Date.parse(e.occurred_at), units: Number(e.insulin_units) })).sort((a, b) => a.t - b.t);
  const out: DoseRow[] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && last.units === x.units) out.push({ ...x, nth: last.nth + 1, prev: last.prev });
    else out.push({ ...x, nth: 1, prev: last ? last.units : null });
  }
  return out;
}

/** Readings to question (never to delete): implausibly fast falls and V-shaped dips (nothing eaten) that reach the low end, and readings close
 *  to a finger-prick that disagrees with them. */
export function questioned(s: Series, eats: number[], pricks: Prick[], from: number, to: number): { from: number; to: number; why: Doubt }[] {
  // a single jumpy reading is noise, not a pattern: look at each reading with its neighbours (median of three)
  const { t } = s, v = s.v.map((x, i, a) => (i === 0 || i === a.length - 1 ? x : [a[i - 1], x, a[i + 1]].sort((p, q) => p - q)[1]));
  const out: { from: number; to: number; why: Doubt }[] = [];
  const ateBetween = (a: number, b: number) => eats.some((x) => x >= a && x <= b);
  for (let i = 0; i < t.length; i++) {
    if (t[i] < from || t[i] >= to) continue;
    for (let j = i + 1; j < t.length && t[j] - t[i] <= 20 * MIN; j++) {
      if (t[j] - t[i] < 10 * MIN) continue;
      if (v[j] < NT.doubtBelow && (v[i] - v[j]) / ((t[j] - t[i]) / MIN) >= NT.fastFall) { out.push({ from: t[i], to: t[j], why: 'fast_fall' }); break; }
    }
    // a local low with a reading 30 higher before (≤30 min) and after (≤45 min), nothing eaten in between
    if (i > 0 && i < t.length - 1 && v[i] < NT.doubtBelow && v[i] <= v[i - 1] && v[i] <= v[i + 1]) {
      let a = -1, b = -1;
      for (let k = i - 1; k >= 0 && t[i] - t[k] <= NT.vBeforeMin * MIN; k--) if (v[k] - v[i] >= NT.vDrop) { a = k; break; }
      for (let k = i + 1; k < t.length && t[k] - t[i] <= NT.vAfterMin * MIN; k++) if (v[k] - v[i] >= NT.vDrop) { b = k; break; }
      if (a >= 0 && b >= 0 && !ateBetween(t[a] - 15 * MIN, t[b])) out.push({ from: t[a], to: t[b], why: 'v_shape' });
    }
  }
  for (const p of pricks) if (p.agrees === false && p.t >= from - NT.prickMin * MIN && p.t < to + NT.prickMin * MIN) out.push({ from: p.t - NT.prickMin * MIN, to: p.t + NT.prickMin * MIN, why: 'prick' });
  return out.sort((a, b) => a.from - b.from);
}

const inSpans = (x: number, spans: { from: number; to: number }[]) => spans.some((q) => x >= q.from && x <= q.to);

export function nightReport(inp: NightInputs): NightReport {
  const { series, history, events, now } = inp;
  const from = dayStartOf(inp.from), today = dayStartOf(now);
  const entries = entriesFrom(history, events), marks = basalMarks(entries);
  const rapid = entries.filter((e) => e.kind === 'dose').map((e) => e.t);
  const food = entries.filter((e) => e.kind === 'meal' || e.kind === 'carbs').map((e) => e.t);
  const eats = entries.filter((e) => e.kind === 'meal' || e.kind === 'carbs' || e.kind === 'treatment').map((e) => e.t);
  const treats = events.filter((e) => !e.deleted_at && e.kind === 'treatment').map((e) => ({ t: Date.parse(e.occurred_at), grams: Number(e.carbs_g ?? 0), name: e.treatment ?? null }));
  const doses = doseRows(events);
  const long = doses.map((d) => ({ t: d.t, units: d.units }));
  const allPricks: Prick[] = prickPoints(events.filter((e) => !e.deleted_at && e.kind === 'bg_check' && e.bg_mgdl).map((e) => ({ t: Date.parse(e.occurred_at), bg: Number(e.bg_mgdl) })).sort((a, b) => a.t - b.t), series.t, series.v)
    .map((p) => ({ ...p, agrees: p.libre === null ? null : agreesWith(p.bg, p.libre) }));
  const tr = treats.map((x) => x.t);
  const rows70 = nightRows(series.t, series.v, tr, from, now, NT.evening, NT.morning, NT.lowMg);
  const rows54 = new Map(nightRows(series.t, series.v, tr, from, now, NT.evening, NT.morning, NT.veryLowMg).map((r) => [r.start, r]));
  const lastBefore = <T extends { t: number }>(xs: T[], at: number) => { let r: T | null = null; for (const x of xs) { if (x.t <= at) r = x; else break; } return r; };

  const nights: Night[] = [];
  for (const row of rows70) {
    if (row.end > now) continue; // only finished nights
    const day = dayStartOf(row.start), coreFrom = day + NT.coreFromH * H, coreTo = day + NT.coreToH * H;
    const d = lastBefore(doses, coreFrom);
    const dose = d && coreFrom - d.t <= 30 * H ? d : null;
    const pricks = allPricks.filter((p) => p.t >= row.start && p.t < row.end);
    const q = questioned(series, eats, pricks, row.start, row.end);
    // the rate: long-acting-only stretches in 00:00–06:00, with the questioned readings left out of the fit only
    let keep = 0;
    const kt: number[] = [], kv: number[] = [];
    let seen = 0; // ms with readings
    for (let i = 0; i < series.t.length; i++) {
      const x = series.t[i];
      if (x < coreFrom || x >= coreTo) continue;
      seen += Math.min(15 * MIN, (i + 1 < series.t.length ? series.t[i + 1] : x + 5 * MIN) - x, coreTo - x);
      if (inSpans(x, q)) continue;
      kt.push(x); kv.push(series.v[i]); keep++;
    }
    const stretches = keep ? basalStretches({ t: Float64Array.from(kt), v: Float64Array.from(kv) }, marks, long, NT.lowMg, coreFrom, coreTo, BASAL_DEFAULTS) : [];
    const rateMin = stretches.reduce((a, x) => a + (x.to - x.from) / MIN, 0);
    const rate = rateMin ? round1(stretches.reduce((a, x) => a + x.rate * (x.to - x.from) / MIN, 0) / rateMin) : null;
    const coverage = Math.min(1, seen / (coreTo - coreFrom)); // a reading counts until the next, up to 15 minutes
    const treatments: Treatment[] = treats.filter((x) => x.t >= row.start && x.t < row.end).map((x) => {
      const i = near(series.t, x.t), j = near(series.t, x.t - NT.juiceLookMin * MIN, 10 * MIN);
      const at = i < 0 ? null : series.v[i], before = j < 0 ? null : series.v[j];
      const fallBefore = at === null || before === null ? null : before - at;
      let peak: number | null = null;
      for (let k = 0; k < series.t.length; k++) if (series.t[k] > x.t && series.t[k] <= x.t + 90 * MIN && (peak === null || series.v[k] > peak)) peak = series.v[k];
      return { ...x, at, fallBefore, interrupted: fallBefore !== null && fallBefore >= NT.juiceFall, peakAfter: peak };
    });
    const lr = lastBefore(rapid.map((t) => ({ t })), coreTo - 1), lf = lastBefore(food.map((t) => ({ t })), coreTo - 1);
    const tags = {
      rapid: lr && lr.t >= coreFrom - BASAL_DEFAULTS.rapid_gap_min * MIN ? lr.t : null,
      food: lf && lf.t >= coreFrom - BASAL_DEFAULTS.food_gap_min * MIN ? lf.t : null,
      juice: treatments.some((x) => x.t < coreTo), // a treatment after 06:00 ends the night; it does not disturb the rate
      sensor: [...new Set([...q.filter((x) => x.to >= coreFrom && x.from < coreTo).map((x) => x.why), ...(coverage < NT.coverage ? ['gaps' as const] : [])])],
    };
    const cls: NightClass = tags.juice ? 'juice' : tags.sensor.length ? 'sensor' : rateMin >= NT.cleanMin ? 'clean' : tags.rapid !== null || tags.food !== null ? 'insulin_food' : 'sensor';
    if (cls === 'sensor' && !tags.sensor.length) tags.sensor.push('gaps');
    let minQ = false, lowAt: number | null = null;
    for (let i = 0; i < series.t.length; i++) if (series.t[i] >= row.start && series.t[i] < row.end && series.v[i] === row.min) { lowAt ??= series.t[i]; if (inSpans(series.t[i], q)) minQ = true; }
    nights.push({
      day, start: row.start, end: row.end, coreFrom, coreTo, dose, settling: !!dose && dose.prev !== null && dose.nth <= NT.settle,
      cls, tags, min: row.min, lowAt, minQuestioned: minQ, below70: row.minutesBelow, below54: rows54.get(row.start)?.minutesBelow ?? 0, coverage: round1(coverage * 100) / 100,
      rate, rateMin: Math.round(rateMin), rateStart: stretches[0]?.start ?? null, sinceRapidMin: stretches[0]?.sinceRapidMin ?? null, stretches,
      treatments, pricks, questioned: q,
    });
  }

  // by dose: rates from clean, steady nights only; settling nights are a group of their own
  const groups: DoseGroup[] = [];
  for (const n of nights) {
    if (!n.dose) continue;
    let g = groups.find((x) => x.units === n.dose!.units && x.settling === n.settling);
    if (!g) groups.push(g = { units: n.dose.units, settling: n.settling, nights: 0, clean: 0, rates: stat([]), range: null, conf: 'too_few', periods: stat([]), low: 0, juice: 0 });
    g.nights++;
    if (n.min !== null && n.min < NT.lowMg) g.low++;
    if (n.cls === 'juice') g.juice++;
  }
  for (const g of groups) {
    const r = nights.filter((n) => n.dose?.units === g.units && n.settling === g.settling && n.cls === 'clean' && n.rate !== null).map((n) => n.rate!);
    g.clean = r.length; g.rates = stat(r); g.range = r.length ? [Math.min(...r), Math.max(...r)] : null;
    g.conf = r.length < NT.fewN ? 'too_few' : r.length < NT.lowN ? 'low' : 'moderate';
    g.periods = stat(nights.filter((n) => n.dose?.units === g.units && n.settling === g.settling && n.cls !== 'sensor' && n.rate !== null).map((n) => n.rate!));
  }
  const order = (x: DoseGroup) => doses.findIndex((d) => d.units === x.units);
  groups.sort((a, b) => order(a) - order(b) || Number(b.settling) - Number(a.settling));

  // whole days (Kuwait), the long-acting dose in force, and what else went in
  const days: DayRow[] = [];
  for (let d = from; d < today; d += DAY) {
    const x = dayTotals(history, events, d, d + DAY);
    if (!x.long && !x.rapid && !x.carbs) continue;
    const dose = lastBefore(doses, d + DAY - 1);
    const juices = events.filter((e) => !e.deleted_at && e.kind === 'treatment' && Date.parse(e.occurred_at) >= d && Date.parse(e.occurred_at) < d + DAY).length;
    days.push({ day: d, units: dose && d + DAY - dose.t <= 48 * H ? dose.units : null, long: x.long, rapid: x.rapid, total: round1(x.long + x.rapid), carbs: x.carbs, juices, juiceG: x.treatment });
  }
  const dayGroups: DayGroup[] = [];
  for (const r of days) {
    if (r.units === null || !r.long) continue;
    let g = dayGroups.find((x) => x.units === r.units);
    if (!g) dayGroups.push(g = { units: r.units, days: 0, long: 0, rapid: 0, total: 0, carbs: 0, juices: 0 });
    g.days++; g.long += r.long; g.rapid += r.rapid; g.total += r.total; g.carbs += r.carbs; g.juices += r.juices;
  }
  for (const g of dayGroups) for (const k of ['long', 'rapid', 'total', 'carbs', 'juices'] as const) g[k] = round1(g[k] / g.days);
  dayGroups.sort((a, b) => doses.findIndex((d) => d.units === a.units) - doses.findIndex((d) => d.units === b.units));

  return { from, to: now, doses: doses.filter((d) => d.t >= from - 2 * DAY), nights: nights.reverse(), groups, days, dayGroups };
}

/** When the dose changed: the first dose at new units. */
export const changesOf = (doses: DoseRow[]) => doses.filter((d) => d.nth === 1);
/** Clock time of the injection (Kuwait), minutes after midnight. */
export const clockOf = (t: number) => Math.floor(((t + 3 * H) % DAY) / MIN);
