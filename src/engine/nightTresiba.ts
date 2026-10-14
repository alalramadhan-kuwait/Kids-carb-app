// Analysis → Night: what her glucose does overnight on each Tresiba dose. Read only, pure, tested in Node. It reuses the
// long-acting-only stretches (basal.ts), the night rows (nights.ts), the day totals (day.ts) and the finger-prick pairing
// (prick.ts) the other pages use; it adds only the sorting of nights and the grouping by dose.
//
// It describes. It never proposes a dose, never says the long-acting dose is too much or too little, never changes or
// drops a sensor reading (a questioned reading is only left out of the rate of fall; its low still counts), and never
// guesses where glucose would have gone without a treatment.
//
// A juice at night is a safety action: the family wakes her when glucose is low or about to be. It is never read as
// Tresiba failing. What the page studies is the fall BEFORE each juice; the rise after it is never part of any rate.
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
  episodeMin: 45,                      // a juice within 45 minutes of the last is the 15-minute-rule repeat of the same episode
  prickBeforeMin: 30, prickAfterMin: 5, // a finger-prick this close to the first juice says why it was given
  minFall: 15, minFallMin: 30,         // a fall is measured when it is 15 mg/dL or more over 30 minutes or more
  minFastMin: 30,                      // the fasting part of a fall is measured when it lasts 30 minutes or more
  gapMin: 20,                          // a gap in readings this long ends the fall (it cannot be traced across it)
  fewN: 3, lowN: 7,                    // clean nights: under 3 too few; under 7 low confidence
  lowMg: 70, veryLowMg: 54,
} as const;

export type NightClass = 'clean' | 'treated' | 'insulin_food' | 'sensor';
export const CLASSES: NightClass[] = ['clean', 'treated', 'insulin_food', 'sensor'];
/** Why a juice was given, from what was measured then: only a finger-prick confirms a low. */
export type Evidence = 'confirmed_low' | 'sensor_low' | 'sensor_low_finger_higher' | 'preventive' | 'preventive_finger';
export const EVIDENCE: Evidence[] = ['confirmed_low', 'sensor_low', 'sensor_low_finger_higher', 'preventive_finger', 'preventive'];
export type Doubt = 'fast_fall' | 'v_shape' | 'prick' | 'gaps';

export interface DoseRow { t: number; units: number; nth: number; prev: number | null } // nth: 1st, 2nd… dose at these units
/** A low treatment. asFood: logged as a meal or snack and counted as a treatment because the readings or the timing say so
 *  (an inference, shown as such); the log itself is never changed. */
export interface Juice { t: number; grams: number; name: string | null; asFood: boolean; why: 'logged' | 'low_reading' | 'after_treatment' }
/** A drink logged as food at night that may have been a treatment but nothing measured says so: it stays food and is
 *  listed for the family to confirm. */
export interface Unsure { t: number; grams: number; name: string | null; libre: number | null }
/** A later treatment in the same episode (the 15-minute rule: recheck, treat again if still falling): what the readings
 *  did between the previous treatment and this one. Nothing here says the previous treatment failed. */
export interface FollowUp { t: number; afterMin: number; libre: number | null; trend: number | null; lowest: number | null; lowestAt: number | null; pricks: Prick[] }
export interface Prick { t: number; bg: number; libre: number | null; diff: number | null; agrees: boolean | null }
/** One low treatment: the first juice and any 15-minute-rule repeats, and what glucose did BEFORE the first. */
export interface Episode {
  t: number; juices: Juice[]; grams: number; followUps: FollowUp[]; // juices[0] is the first treatment; followUps[i] belongs to juices[i + 1]
  libre: number | null; trend: number | null;     // the sensor at the first juice; mg/dL per minute over the 15 minutes before
  fall: { from: number; start: number; minutes: number; rate: number | null } | null; // from the highest reading since the last entry
  fasting: { from: number; minutes: number; rate: number | null } | null;            // the part 6 h after NovoRapid, 3 h after food
  sinceRapidMin: number | null;                   // from the last NovoRapid to the start of the fall
  prick: (Prick & { after: boolean }) | null;     // the nearest finger-prick within 30 minutes; after = later than 5 min after the juice
  evidence: Evidence; doubt: Doubt[]; gap: boolean;
  lowestAfter: number | null;                     // the lowest sensor reading in the 30 minutes after: shown, never used in a rate
}
export interface Night {
  day: number; start: number; end: number; coreFrom: number; coreTo: number;
  dose: DoseRow | null; settling: boolean;
  cls: NightClass; tags: { rapid: number | null; food: number | null; treated: boolean; sensor: Doubt[] }; // rapid/food: when, if within reach of 00:00–06:00
  min: number | null; lowAt: number | null; minQuestioned: boolean; below70: number; below54: number; coverage: number;
  rate: number | null; rateMin: number; rateStart: number | null; sinceRapidMin: number | null; stretches: Stretch[];
  episodes: Episode[]; unsure: Unsure[]; pricks: Prick[]; questioned: { from: number; to: number; why: Doubt }[];
}
/** rates: clean nights only. before: the fasting part of the fall before each juice (no questioned readings), which ends
 *  where a juice was needed, so it leans towards falls; it is shown beside the clean nights, never pooled with them. */
export interface DoseGroup { units: number; settling: boolean; nights: number; clean: number; rates: Stat; range: [number, number] | null; conf: Confidence; before: Stat; low: number; treated: number; episodes: number; treatments: number; evidence: Record<Evidence, number> }
export interface DayRow { day: number; units: number | null; long: number; rapid: number; total: number; carbs: number; juices: number; juiceG: number }
export interface DayGroup { units: number; days: number; long: number; rapid: number; total: number; carbs: number; juices: number }
export interface NightReport { from: number; to: number; unsure: Unsure[]; doses: DoseRow[]; nights: Night[]; groups: DoseGroup[]; days: DayRow[]; dayGroups: DayGroup[] }

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

const DRINK = /عصير|كوكتيل|مشروب|حليب|cocktail|juice|nectar|drink|milk/i; // i18n-ok: matches log names
const atNightClock = (t: number) => { const h = new Date(t + 3 * H).getUTCHours(); return h >= 21 || h < 7; };
/** Low treatments: every treatment entry, and a drink logged as food at night (not part of a meal) when something measured
 *  says it was one: the sensor was under 90 (5.0) then, or it came within 45 minutes after another treatment (the 15-minute
 *  rule). Any other night drink logged as food stays food and is returned as unsure, for the family to confirm. */
export const DRINK_TREAT_MG = 90;
export function juicesOf(history: HistoryEntry[], events: EventRow[], s: Series): { juices: Juice[]; unsure: Unsure[]; keys: Set<string> } {
  const logged: Juice[] = events.filter((e) => !e.deleted_at && e.kind === 'treatment').map((e) => ({ t: Date.parse(e.occurred_at), grams: Number(e.carbs_g ?? 0), name: e.treatment ?? null, asFood: false, why: 'logged' as const }));
  const meals = history.map((h) => ({ key: 'h:' + h.id, t: Date.parse(h.eaten_at), g: Number(h.total_carbs ?? 0), name: h.name ?? '' }));
  const drinks = meals.filter((m) => DRINK.test(m.name) && atNightClock(m.t) && m.g > 0 && m.g <= 30
    && !meals.some((o) => o !== m && !DRINK.test(o.name) && o.g >= 10 && Math.abs(o.t - m.t) <= 15 * MIN)).sort((a, b) => a.t - b.t);
  const juices = [...logged], unsure: Unsure[] = [], keys = new Set<string>();
  for (const m of drinks) {
    const i = near(s.t, m.t), libre = i < 0 ? null : s.v[i];
    const after = juices.some((j) => j.t < m.t && m.t - j.t <= NT.episodeMin * MIN);
    const why = libre !== null && libre < DRINK_TREAT_MG ? 'low_reading' : after ? 'after_treatment' : null;
    if (why) { juices.push({ t: m.t, grams: m.g, name: m.name, asFood: true, why }); keys.add(m.key); } else unsure.push({ t: m.t, grams: m.g, name: m.name, libre });
  }
  return { juices: juices.sort((a, b) => a.t - b.t), unsure, keys };
}

/** Juices within 45 minutes of the previous one belong to one episode (the 15-minute rule: treat, recheck, treat again). */
export function episodesOf(juices: Juice[]): Juice[][] {
  const out: Juice[][] = [];
  for (const j of juices) { const last = out[out.length - 1]; if (last && j.t - last[last.length - 1].t <= NT.episodeMin * MIN) last.push(j); else out.push([j]); }
  return out;
}

/** What glucose did before the first juice of an episode. Smoothed (median of three) and without questioned readings;
 *  nothing after the juice is used except the lowest reading in the next 30 minutes, which is only shown. */
export function preTreatment(s: Series, sm: ArrayLike<number>, juices: Juice[], q: { from: number; to: number }[], pricks: Prick[],
  last: { rapid: number | null; food: number | null; treat: number | null }): Episode {
  const t0 = juices[0].t, { t, v } = s;
  const valid = (i: number) => !inSpans(t[i], q);
  const i0 = near(t, t0);
  const libre = i0 < 0 ? null : v[i0];
  const i15 = near(t, t0 - 15 * MIN, 5 * MIN);
  const trend = i0 >= 0 && i15 >= 0 ? round1((sm[i0] - sm[i15]) / ((t[i0] - t[i15]) / MIN)) : null;
  // the fall starts at the highest valid reading after the last entry (and after any long gap), at most 4 hours back
  const entry = Math.max(t0 - 4 * H, last.rapid ?? 0, last.food ?? 0, last.treat ?? 0);
  let edge = entry + 10 * MIN, gap = false;
  for (let i = 1; i < t.length && t[i] <= t0; i++) if (t[i] > entry && t[i] - t[i - 1] > NT.gapMin * MIN) { edge = Math.max(edge, t[i]); gap = true; }
  if (i0 >= 0 && t0 - t[i0] > 0 && t0 - t[i0] > NT.gapMin * MIN) gap = true;
  let peak = -1;
  for (let i = 0; i < t.length && t[i] <= t0; i++) if (t[i] >= edge && valid(i) && (peak < 0 || sm[i] > sm[peak])) peak = i;
  const fit = (a: number, b: number) => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < t.length && t[i] <= b; i++) if (t[i] >= a && valid(i)) { xs.push((t[i] - a) / H); ys.push(sm[i]); }
    if (xs.length < 3) return null;
    const mx = xs.reduce((p, x) => p + x, 0) / xs.length, my = ys.reduce((p, y) => p + y, 0) / ys.length, sxx = xs.reduce((p, x) => p + (x - mx) ** 2, 0);
    return sxx ? Math.round(xs.reduce((p, x, k) => p + (x - mx) * (ys[k] - my), 0) / sxx) : null;
  };
  let fall: Episode['fall'] = null;
  if (peak >= 0 && libre !== null) {
    const minutes = Math.round((t0 - t[peak]) / MIN);
    fall = { from: t[peak], start: sm[peak], minutes, rate: sm[peak] - libre >= NT.minFall && minutes >= NT.minFallMin ? fit(t[peak], t0) : null };
  }
  let fasting: Episode['fasting'] = null;
  if (fall) {
    const from = Math.max(fall.from, (last.rapid ?? 0) + BASAL_DEFAULTS.rapid_gap_min * MIN, (last.food ?? 0) + BASAL_DEFAULTS.food_gap_min * MIN, (last.treat ?? 0) + BASAL_DEFAULTS.food_gap_min * MIN);
    const minutes = Math.max(0, Math.round((t0 - from) / MIN));
    fasting = minutes ? { from, minutes, rate: minutes >= NT.minFastMin ? fit(from, t0) : null } : null;
  }
  const near30 = pricks.filter((p) => Math.abs(p.t - t0) <= 30 * MIN).sort((a, b) => Math.abs(a.t - t0) - Math.abs(b.t - t0))[0];
  const decides = pricks.filter((p) => p.t >= t0 - NT.prickBeforeMin * MIN && p.t <= t0 + NT.prickAfterMin * MIN).sort((a, b) => Math.abs(a.t - t0) - Math.abs(b.t - t0))[0];
  const evidence: Evidence = decides ? (decides.bg < NT.lowMg ? 'confirmed_low' : libre !== null && libre < NT.lowMg ? 'sensor_low_finger_higher' : 'preventive_finger')
    : libre !== null && libre < NT.lowMg ? 'sensor_low' : 'preventive';
  let lowestAfter: number | null = null;
  const until = Math.min(t0 + 30 * MIN, juices[1]?.t ?? Infinity); // up to the next treatment
  for (let i = 0; i < t.length; i++) if (t[i] > t0 && t[i] <= until && (lowestAfter === null || v[i] < lowestAfter)) lowestAfter = v[i];
  const from = fall?.from ?? t0;
  const followUps: FollowUp[] = juices.slice(1).map((j, k) => {
    const prev = juices[k].t, i = near(t, j.t), i15 = near(t, j.t - 15 * MIN, 5 * MIN);
    let lo: number | null = null, at: number | null = null;
    for (let x = 0; x < t.length; x++) if (t[x] > prev && t[x] <= j.t && (lo === null || v[x] < lo)) { lo = v[x]; at = t[x]; }
    return { t: j.t, afterMin: Math.round((j.t - prev) / MIN), libre: i < 0 ? null : v[i], trend: i >= 0 && i15 >= 0 ? round1((sm[i] - sm[i15]) / ((t[i] - t[i15]) / MIN)) : null,
      lowest: lo, lowestAt: at, pricks: pricks.filter((p) => p.t >= t0 - NT.prickBeforeMin * MIN && p.t <= j.t + NT.prickAfterMin * MIN) };
  });
  return {
    t: t0, juices, grams: juices.reduce((a, j) => a + j.grams, 0), followUps, libre, trend, fall, fasting,
    sinceRapidMin: last.rapid === null ? null : Math.round((from - last.rapid) / MIN),
    prick: near30 ? { ...near30, after: near30.t > t0 + NT.prickAfterMin * MIN } : null, evidence,
    doubt: [...new Set((q as { from: number; to: number; why: Doubt }[]).filter((x) => x.to >= from && x.from <= t0).map((x) => x.why))], gap, lowestAfter,
  };
}

export function nightReport(inp: NightInputs): NightReport {
  const { series, history, events, now } = inp;
  const from = dayStartOf(inp.from), today = dayStartOf(now);
  const { juices, unsure, keys: juiceMeals } = juicesOf(history, events, series);
  const entries = entriesFrom(history, events).map((e) => (juiceMeals.has(e.key) ? { ...e, kind: 'treatment' as const } : e)), marks = basalMarks(entries);
  const rapid = entries.filter((e) => e.kind === 'dose').map((e) => e.t);
  const food = entries.filter((e) => e.kind === 'meal' || e.kind === 'carbs').map((e) => e.t);
  const eats = entries.filter((e) => e.kind === 'meal' || e.kind === 'carbs' || e.kind === 'treatment').map((e) => e.t);
  const episodes = episodesOf(juices);
  const sv = series.v, sm = Array.from(sv, (x: number, i: number) => (i === 0 || i === sv.length - 1 ? x : [sv[i - 1], x, sv[i + 1]].sort((p, q) => p - q)[1]));
  const before = (xs: number[], t: number) => { let r: number | null = null; for (const x of xs) if (x < t - 2 * MIN && (r === null || x > r)) r = x; return r; };
  const doses = doseRows(events);
  const long = doses.map((d) => ({ t: d.t, units: d.units }));
  const allPricks: Prick[] = prickPoints(events.filter((e) => !e.deleted_at && e.kind === 'bg_check' && e.bg_mgdl).map((e) => ({ t: Date.parse(e.occurred_at), bg: Number(e.bg_mgdl) })).sort((a, b) => a.t - b.t), series.t, series.v)
    .map((p) => ({ ...p, agrees: p.libre === null ? null : agreesWith(p.bg, p.libre) }));
  const tr = juices.map((x) => x.t);
  const rows70 = nightRows(series.t, series.v, tr, from, now, NT.evening, NT.morning, NT.lowMg);
  const rows54 = new Map(nightRows(series.t, series.v, tr, from, now, NT.evening, NT.morning, NT.veryLowMg).map((r) => [r.start, r]));
  const lastBefore = <T extends { t: number }>(xs: T[], at: number) => { let r: T | null = null; for (const x of xs) { if (x.t <= at) r = x; else break; } return r; };

  const allQ = (t0: number) => questioned(series, eats, allPricks.filter((p) => p.t >= t0 - 5 * H && p.t <= t0 + H), t0 - 5 * H, t0 + H);
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
    const eps: Episode[] = episodes.filter((e) => e[0].t >= row.start && e[0].t < row.end)
      .map((e) => preTreatment(series, sm, e, allQ(e[0].t), allPricks, { rapid: before(rapid, e[0].t), food: before(food, e[0].t), treat: before(juices.map((j) => j.t), e[0].t) }));
    const lr = lastBefore(rapid.map((t) => ({ t })), coreTo - 1), lf = lastBefore(food.map((t) => ({ t })), coreTo - 1);
    const tags = {
      rapid: lr && lr.t >= coreFrom - BASAL_DEFAULTS.rapid_gap_min * MIN ? lr.t : null,
      food: lf && lf.t >= coreFrom - BASAL_DEFAULTS.food_gap_min * MIN ? lf.t : null,
      treated: eps.some((x) => x.t < coreTo), // a juice after 06:00 ends the night; it does not disturb the rate
      sensor: [...new Set([...q.filter((x) => x.to >= coreFrom && x.from < coreTo).map((x) => x.why), ...(coverage < NT.coverage ? ['gaps' as const] : [])])],
    };
    const cls: NightClass = tags.treated ? 'treated' : tags.sensor.length ? 'sensor' : rateMin >= NT.cleanMin ? 'clean' : tags.rapid !== null || tags.food !== null ? 'insulin_food' : 'sensor';
    if (cls === 'sensor' && !tags.sensor.length) tags.sensor.push('gaps');
    let minQ = false, lowAt: number | null = null;
    for (let i = 0; i < series.t.length; i++) if (series.t[i] >= row.start && series.t[i] < row.end && series.v[i] === row.min) { lowAt ??= series.t[i]; if (inSpans(series.t[i], q)) minQ = true; }
    nights.push({
      day, start: row.start, end: row.end, coreFrom, coreTo, dose, settling: !!dose && dose.prev !== null && dose.nth <= NT.settle,
      cls, tags, min: row.min, lowAt, minQuestioned: minQ, below70: row.minutesBelow, below54: rows54.get(row.start)?.minutesBelow ?? 0, coverage: round1(coverage * 100) / 100,
      rate, rateMin: Math.round(rateMin), rateStart: stretches[0]?.start ?? null, sinceRapidMin: stretches[0]?.sinceRapidMin ?? null, stretches,
      episodes: eps, unsure: unsure.filter((u) => u.t >= row.start && u.t < row.end), pricks, questioned: q,
    });
  }

  // by dose: rates from clean, steady nights only; settling nights are a group of their own
  const groups: DoseGroup[] = [];
  for (const n of nights) {
    if (!n.dose) continue;
    let g = groups.find((x) => x.units === n.dose!.units && x.settling === n.settling);
    if (!g) groups.push(g = { units: n.dose.units, settling: n.settling, nights: 0, clean: 0, rates: stat([]), range: null, conf: 'too_few', before: stat([]), low: 0, treated: 0, episodes: 0, treatments: 0,
      evidence: { confirmed_low: 0, sensor_low: 0, sensor_low_finger_higher: 0, preventive: 0, preventive_finger: 0 } });
    g.nights++;
    if (n.min !== null && n.min < NT.lowMg) g.low++;
    if (n.episodes.length) g.treated++;
    g.episodes += n.episodes.length;
    g.treatments += n.episodes.reduce((a, e) => a + e.juices.length, 0);
    for (const e of n.episodes) g.evidence[e.evidence]++;
  }
  for (const g of groups) {
    const r = nights.filter((n) => n.dose?.units === g.units && n.settling === g.settling && n.cls === 'clean' && n.rate !== null).map((n) => n.rate!);
    g.clean = r.length; g.rates = stat(r); g.range = r.length ? [Math.min(...r), Math.max(...r)] : null;
    g.conf = r.length < NT.fewN ? 'too_few' : r.length < NT.lowN ? 'low' : 'moderate';
    g.before = stat(nights.filter((n) => n.dose?.units === g.units && n.settling === g.settling).flatMap((n) => n.episodes).filter(fastingBefore).map((e) => e.fasting!.rate!));
  }
  const order = (x: DoseGroup) => doses.findIndex((d) => d.units === x.units);
  groups.sort((a, b) => order(a) - order(b) || Number(b.settling) - Number(a.settling));

  // whole days (Kuwait), the long-acting dose in force, and what else went in
  const days: DayRow[] = [];
  for (let d = from; d < today; d += DAY) {
    const x = dayTotals(history, events, d, d + DAY);
    if (!x.long && !x.rapid && !x.carbs) continue;
    const dose = lastBefore(doses, d + DAY - 1);
    const inDay = juices.filter((j) => j.t >= d && j.t < d + DAY), asFood = inDay.filter((j) => j.asFood).reduce((a, j) => a + j.grams, 0);
    days.push({ day: d, units: dose && d + DAY - dose.t <= 48 * H ? dose.units : null, long: x.long, rapid: x.rapid, total: round1(x.long + x.rapid), carbs: round1(x.carbs - asFood), juices: inDay.length, juiceG: round1(x.treatment + asFood) });
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

  return { from, to: now, unsure: unsure.filter((u) => u.t >= from), doses: doses.filter((d) => d.t >= from - 2 * DAY), nights: nights.reverse(), groups, days, dayGroups };
}

/** A fasting fall before a juice that can be measured: 30 minutes or more, no questioned readings, no gap. */
export const fastingBefore = (e: Episode) => !!e.fasting && e.fasting.rate !== null && !e.doubt.length && !e.gap;

/** When the dose changed: the first dose at new units. */
export const changesOf = (doses: DoseRow[]) => doses.filter((d) => d.nth === 1);
/** Clock time of the injection (Kuwait), minutes after midnight. */
export const clockOf = (t: number) => Math.floor(((t + 3 * H) % DAY) / MIN);
