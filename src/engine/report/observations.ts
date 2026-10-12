// Clinical report engine, part 12: observations and questions for the care team (the visit report's last section).
// Reads the same period's readings, insulin, meals and treatments as every other report section, plus what the app
// knows about meal composition, activity and nutrition, and finds patterns worth DISCUSSING. Pure, tested in Node.
//
// Rules it keeps (the family's brief):
//  - every finding comes from her data, with the numbers and dates behind it; nothing generic is shown as a finding;
//  - other explanations (timing, a high start, meal composition, insulin still working, activity, missing data) are
//    checked first and listed as possible, not confirmed;
//  - too little evidence is said plainly, never stretched into a conclusion;
//  - it never calculates or proposes a dose, a ratio or a correction factor. Questions only.
import { MIN, kwMinuteOfDay, type Reading } from './cgm';
import { glucoseEvents } from './events';
import { basalStretches, basalSummary, BASAL_DEFAULTS, atNight, type Mark } from '../basal';
import type { Mealtime, MealSlot, Sitting } from './mealtime';
import type { ReportInsulin, ReportMeal, ReportTreatment } from './days';

const H = 60 * MIN;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Thresholds, in one place so the PDF can print them. mg/dL unless named. */
export const OBS_RULES = {
  spike2hMg: 180,        // 2 hours after eating above the range
  riseMg: 63,            // or a rise of 3.5 mmol/L from before eating to the peak
  minSittings: 4,        // a meal period needs this many sittings with sensor data and a dose to be judged
  repeatShare: 0.5,      // "repeated": at least half of them…
  minRepeats: 3,         // …and at least this many
  lateDoseMin: 0,        // a dose after the first bite
  correctionHighMg: 180, // a correction given above this
  cleanAfterH: 3,        // a correction is read 3 hours later, if nothing was eaten and no other rapid dose given
  minCorrections: 3,
  minNights: 3,
  lowAfterDoseH: 4,      // a low within 4 h of rapid insulin
  lowAfterActivityH: 6,
  fattyG: 20, proteinG: 25,
};

export type Audience = 'doctor' | 'dietitian';
export type Kind = 'meal_rise' | 'dose_timing' | 'missed_dose' | 'corrections' | 'overnight' | 'lows' | 'energy' | 'growth' | 'meal_makeup' | 'balance' | 'carb_spread';
/** One finding: `data` holds what was confirmed in her records; `maybe`, possible explanations NOT confirmed. Words are added by the page. */
export interface Finding {
  audience: Audience; kind: Kind; score: number;
  data: Record<string, any>;
  maybe: { key: string; p?: Record<string, any> }[];
}
export interface Gap { audience: Audience; key: string; p?: Record<string, any> }

export interface NutritionIn {
  days: number; enough: boolean; kcal: number | null; ref: { kcal: number; low: number; high: number; source: string } | null;
  energyState: 'within' | 'below' | 'above' | 'insufficient'; coverage: number;
  pct: { carbs: number | null; fat: number | null; protein: number | null };
  balanceState: 'balanced' | 'attention' | 'insufficient'; issues: string[];
  growth: { state: string; measurements: number; latest: { on: string; weight: number | null; height: number | null; pW: number | null; pH: number | null; pBmi: number | null } | null; change90: number | null; reasons: string[] };
}
export interface ObsInput {
  readings: Reading[]; from: number; to: number; now: number;
  insulin: ReportInsulin[]; meals: ReportMeal[]; treatments: ReportTreatment[];
  mealtime: Mealtime;
  /** what the app knows about each meal's make-up (from the meal history) */
  makeup: { at: number; fat: number | null; protein: number | null; name: string | null }[];
  activities: number[];
  lowMg: number; highMg: number;
  night: { start: string; end: string };
  ratios: { from: string; cr: number }[];
  nutrition: NutritionIn | null;
}
export interface Observations { doctor: Finding[]; dietitian: Finding[]; gaps: Gap[]; quality: { unknownCarbs: number; sittings: number; withDose: number } }

// ── helpers ──
const sorted = (rs: Reading[]) => [...rs].sort((a, b) => a.t - b.t);
function valueAt(rs: Reading[], t: number, within = 10 * MIN): number | null {
  let lo = 0, hi = rs.length - 1, best: Reading | null = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rs[m].t < t) lo = m + 1; else hi = m - 1; }
  for (const i of [lo - 1, lo]) if (rs[i] && Math.abs(rs[i].t - t) <= within && (!best || Math.abs(rs[i].t - t) < Math.abs(best.t - t))) best = rs[i];
  return best ? best.mg : null;
}
const ratioAt = (ratios: { from: string; cr: number }[], t: number) => {
  const m = kwMinuteOfDay(t); let r: { from: string; cr: number } | null = null;
  for (const x of [...ratios].sort((a, b) => a.from.localeCompare(b.from))) { const [h, mm] = x.from.split(':').map(Number); if (h * 60 + (mm || 0) <= m) r = x; }
  const all = [...ratios].sort((a, b) => a.from.localeCompare(b.from));
  return r ?? all[all.length - 1] ?? null;
};
const block = (t: number) => { const h = kwMinuteOfDay(t) / 60; return h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };

export function buildObservations(o: ObsInput): Observations {
  const R = OBS_RULES, rs = sorted(o.readings);
  const end = Math.min(o.to, o.now);
  const rapid = o.insulin.filter((d) => d.type === 'rapid' && d.at >= o.from - 6 * H && d.at < end).sort((a, b) => a.at - b.at);
  const long = o.insulin.filter((d) => d.type === 'long').sort((a, b) => a.at - b.at);
  const doctor: Finding[] = [], dietitian: Finding[] = [], gaps: Gap[] = [];

  // ── meals: the dose for each sitting (first rapid dose from 45 min before to 60 min after) ──
  type S = Sitting & { doseAt: number | null; doseMin: number | null; spike: boolean; judged: boolean; makeup: ObsInput['makeup'][number] | null; startHigh: boolean };
  const sit: S[] = o.mealtime.sittings.map((s) => {
    const d = rapid.find((x) => x.at >= s.at - 45 * MIN && x.at <= s.at + 60 * MIN) ?? null;
    const judged = s.pre !== null && (s.at2h !== null || s.peak !== null);
    const spike = judged && ((s.at2h !== null && s.at2h > R.spike2hMg) || (s.peak !== null && s.pre !== null && s.peak - s.pre >= R.riseMg));
    const mk = o.makeup.filter((m) => Math.abs(m.at - s.at) <= 30 * MIN);
    const makeup = mk.length ? { at: s.at, fat: mk.some((m) => m.fat != null) ? mk.reduce((a, m) => a + (m.fat ?? 0), 0) : null, protein: mk.some((m) => m.protein != null) ? mk.reduce((a, m) => a + (m.protein ?? 0), 0) : null, name: mk.find((m) => m.name)?.name ?? null } : null;
    return { ...s, doseAt: d?.at ?? null, doseMin: d ? Math.round((s.at - d.at) / MIN) : null, spike, judged, makeup, startHigh: s.pre !== null && s.pre > o.highMg };
  });
  const isFatty = (s: S) => !!s.makeup && ((s.makeup.fat ?? 0) >= R.fattyG || (s.makeup.protein ?? 0) >= R.proteinG);

  // 1. repeated rises after one meal period
  for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as MealSlot[]) {
    const all = sit.filter((s) => s.slot === slot);
    const ok = all.filter((s) => s.judged && s.doseAt !== null && (s.carbs ?? 0) >= 10);
    const sp = ok.filter((s) => s.spike);
    if (!all.length) continue;
    if (ok.length < R.minSittings) {
      if (all.length >= 2) gaps.push({ audience: 'doctor', key: 'gap_meal', p: { slot, n: ok.length, all: all.length, need: R.minSittings } });
      continue;
    }
    if (sp.length < R.minRepeats || sp.length < ok.length * R.repeatShare) continue;
    const late = sp.filter((s) => s.doseMin !== null && s.doseMin < R.lateDoseMin).length;
    const high = sp.filter((s) => s.startHigh).length, fatty = sp.filter(isFatty).length;
    const latePeak = sp.filter((s) => (s.peakMin ?? 0) >= 150).length;
    const unknown = all.filter((s) => s.carbs === null).length;
    const r = ratioAt(o.ratios, sp[0].at);
    const maybe: Finding['maybe'] = [];
    // an explanation is listed only when it fits at least 2 of the rises and a third of them
    const fits = (k: number) => k >= 2 && k >= sp.length / 3;
    if (fits(late)) maybe.push({ key: 'm_late_dose', p: { k: late, n: sp.length } });
    if (fits(high)) maybe.push({ key: 'm_start_high', p: { k: high, n: sp.length } });
    if (fits(Math.max(fatty, latePeak))) maybe.push({ key: 'm_makeup', p: { k: Math.max(fatty, latePeak), n: sp.length } });
    if (unknown) maybe.push({ key: 'm_unknown_carbs', p: { k: unknown } });
    maybe.push({ key: 'm_carb_count' });
    doctor.push({
      audience: 'doctor', kind: 'meal_rise', score: 60 + 25 * (sp.length / ok.length) + Math.min(10, sp.length),
      data: { slot, k: sp.length, n: ok.length, pre: median(sp.map((s) => s.pre!)), at2h: median(sp.filter((s) => s.at2h !== null).map((s) => s.at2h!)), peak: median(sp.map((s) => s.peak!).filter((x) => x != null)),
        peakMin: median(sp.map((s) => s.peakMin!).filter((x) => x != null)), carbs: median(sp.map((s) => s.carbs!).filter((x) => x != null)), units: median(sp.map((s) => s.insulin!).filter((x) => x != null)),
        doseMin: median(sp.map((s) => s.doseMin!).filter((x) => x != null)), dates: sp.map((s) => s.at).slice(-6), cr: r?.cr ?? null, lowsAfter: ok.filter((s) => s.lowAfter).length },
      maybe,
    });
  }

  // 2. dose timing across all meals
  const dosed = sit.filter((s) => s.judged && s.doseMin !== null && (s.carbs ?? 0) >= 10);
  const after = dosed.filter((s) => s.doseMin! < R.lateDoseMin), before = dosed.filter((s) => s.doseMin! >= 10);
  if (dosed.length >= 5 && after.length >= 2 && after.length >= dosed.length * 0.3) {
    const a2 = median(after.map((s) => s.at2h!).filter((x) => x != null)), b2 = median(before.map((s) => s.at2h!).filter((x) => x != null));
    doctor.push({ audience: 'doctor', kind: 'dose_timing', score: 55 + 30 * (after.length / dosed.length),
      data: { k: after.length, n: dosed.length, medianAfter: median(after.map((s) => -s.doseMin!)), at2hAfter: a2, at2hBefore: before.length >= 2 ? b2 : null, nBefore: before.length, dates: after.map((s) => s.at).slice(-6) },
      maybe: [{ key: 'm_eating_unsure' }, { key: 'm_logging_time' }] });
  }
  // 3. meals with no dose logged
  const noDose = sit.filter((s) => (s.carbs ?? 0) >= 15 && s.doseAt === null && s.at >= o.from);
  if (noDose.length >= 2) doctor.push({ audience: 'doctor', kind: 'missed_dose', score: 45 + 5 * Math.min(6, noDose.length),
    data: { k: noDose.length, n: sit.filter((s) => (s.carbs ?? 0) >= 15).length, dates: noDose.map((s) => s.at).slice(-6), at2h: median(noDose.map((s) => s.at2h!).filter((x) => x != null)) },
    maybe: [{ key: 'm_not_logged' }, { key: 'm_small_snack' }] });

  // 4. corrections: given above the range, read 3 hours later, only when nothing else could explain the result
  const foodAt = [...o.meals.filter((m) => !m.pending).map((m) => m.at), ...o.treatments.map((x) => x.at)].sort((a, b) => a - b);
  const corr = rapid.filter((d) => d.at >= o.from && (d.purpose === 'correction' || !o.meals.some((m) => Math.abs(m.at - d.at) <= 45 * MIN)))
    .map((d) => ({ d, g0: valueAt(rs, d.at) })).filter((x) => x.g0 !== null && x.g0 > R.correctionHighMg);
  type C = { at: number; units: number; g0: number; g3: number | null; reached: boolean; low: boolean };
  const clean: C[] = [], confounded = { food: 0, iob: 0, data: 0 };
  for (const { d, g0 } of corr) {
    const until = d.at + R.cleanAfterH * H;
    if (foodAt.some((t) => t > d.at && t < until)) { confounded.food++; continue; }
    if (rapid.some((x) => x !== d && x.at > d.at - 3 * H && x.at < until)) { confounded.iob++; continue; }
    const g3 = valueAt(rs, until, 15 * MIN);
    if (g3 === null) { confounded.data++; continue; }
    const seg = rs.filter((r) => r.t > d.at && r.t <= d.at + R.lowAfterDoseH * H);
    clean.push({ at: d.at, units: d.units, g0: g0!, g3, reached: seg.some((r) => r.t <= until && r.mg <= o.highMg), low: seg.some((r) => r.mg < o.lowMg) });
  }
  if (clean.length >= R.minCorrections) {
    const notReached = clean.filter((c) => !c.reached).length, lowAfter = clean.filter((c) => c.low).length;
    const flagged = notReached >= clean.length / 2 || lowAfter >= 2;
    doctor.push({ audience: 'doctor', kind: 'corrections', score: flagged ? 70 + 5 * Math.max(notReached, lowAfter) : 25,
      data: { n: clean.length, all: corr.length, notReached, lowAfter, g0: median(clean.map((c) => c.g0)), g3: median(clean.map((c) => c.g3!)), units: median(clean.map((c) => c.units)), dates: clean.map((c) => c.at).slice(-6), flagged, confounded },
      maybe: flagged ? [{ key: notReached >= lowAfter ? 'm_rise_not_over' : 'm_activity_or_stacking' }, { key: 'm_dose_rounding' }] : [] });
  } else if (corr.length) gaps.push({ audience: 'doctor', key: 'gap_corr', p: { n: clean.length, all: corr.length, food: confounded.food, iob: confounded.iob, data: confounded.data, need: R.minCorrections } });

  // 5. overnight with only Tresiba working
  const marks: Mark[] = [...rapid.map((d) => ({ t: d.at, kind: 'rapid' as const })), ...o.treatments.map((x) => ({ t: x.at, kind: 'treatment' as const })),
    ...o.meals.filter((m) => !m.pending && (m.carbs ?? 5) >= 5).map((m) => ({ t: m.at, kind: 'food' as const }))];
  const series = { t: rs.map((r) => r.t), v: rs.map((r) => r.mg) } as any;
  const night = basalStretches(series, marks, long.map((d) => ({ t: d.at, units: d.units })), o.lowMg, o.from, end, BASAL_DEFAULTS)
    .filter((x) => atNight(x, (t) => kwMinuteOfDay(t), o.night.start, o.night.end));
  const sum = basalSummary(night, BASAL_DEFAULTS, (t) => new Date(t + 3 * H - 12 * H).toISOString().slice(0, 10));
  const rising = night.filter((x) => x.rate >= BASAL_DEFAULTS.fall_mgdl_h).length;
  if (sum.n >= R.minNights) {
    const flagged = sum.falling * 3 >= sum.n * 2 || sum.low >= 2 || rising * 3 >= sum.n * 2;
    const tDose = median(long.filter((d) => d.at >= o.from).map((d) => kwMinuteOfDay(d.at)));
    doctor.push({ audience: 'doctor', kind: 'overnight', score: flagged ? 65 + 5 * Math.max(sum.low, sum.falling, rising) : 20,
      data: { n: sum.n, nights: sum.nights, falling: sum.falling, rising, low: sum.low, rate: sum.rate, drop: sum.drop, flagged, longTime: tDose, longUnits: median(long.filter((d) => d.at >= o.from).map((d) => d.units)), dates: night.filter((x) => x.low).map((x) => x.from).slice(-6) },
      maybe: flagged ? [{ key: sum.low ? 'm_compression' : 'm_dawn' }, { key: 'm_evening_activity' }] : [] });
  } else gaps.push({ audience: 'doctor', key: 'gap_night', p: { n: sum.n, need: R.minNights } });

  // 6. lows: when, and what came before
  const lows = glucoseEvents(rs, o.from, end).hypo1;
  if (lows.length) {
    const ctx = lows.map((e) => {
      const ds = rapid.filter((d) => d.at < e.start && d.at >= e.start - R.lowAfterDoseH * H);
      return { at: e.start, min: e.extreme, minutes: e.minutes, block: block(e.start), afterDose: ds.length > 0, stacked: ds.length >= 2,
        afterActivity: o.activities.some((a) => a < e.start && a >= e.start - R.lowAfterActivityH * H), afterMeal: sit.some((s) => s.at < e.start && s.at >= e.start - R.lowAfterDoseH * H) };
    });
    const by = (k: string) => ctx.filter((c) => c.block === k).length;
    const blocks = { night: by('night'), morning: by('morning'), afternoon: by('afternoon'), evening: by('evening') };
    const ranked = Object.entries(blocks).sort((a, b) => b[1] - a[1]);
    // a time of day only when it clearly leads; a tie is "spread over the day"
    const top: [string, number] | null = ranked[0][1] >= 2 && ranked[0][1] > ranked[1][1] ? ranked[0] : null;
    if (lows.length >= 3 || (top && top[1] >= 2)) {
      const maybe: Finding['maybe'] = [];
      if (ctx.filter((c) => c.stacked).length >= 2) maybe.push({ key: 'm_stacking', p: { k: ctx.filter((c) => c.stacked).length } });
      if (ctx.filter((c) => c.afterActivity).length >= 2) maybe.push({ key: 'm_activity', p: { k: ctx.filter((c) => c.afterActivity).length } });
      if (blocks.night) maybe.push({ key: 'm_compression' });
      doctor.push({ audience: 'doctor', kind: 'lows', score: 75 + 4 * lows.length + (blocks.night ? 10 : 0),
        data: { n: lows.length, blocks, top: top?.[0] ?? null, topN: top?.[1] ?? 0, afterDose: ctx.filter((c) => c.afterDose).length, afterMeal: ctx.filter((c) => c.afterMeal).length,
          lowest: Math.min(...ctx.map((c) => c.min)), minutes: median(ctx.map((c) => c.minutes)), treatments: o.treatments.filter((x) => x.at >= o.from).length, list: ctx.slice(-6).map((c) => ({ at: c.at, min: c.min, minutes: c.minutes })) },
        maybe });
    }
  }

  // ── dietitian ──
  const n = o.nutrition;
  if (n) {
    if (n.energyState === 'insufficient') gaps.push({ audience: 'dietitian', key: 'gap_energy', p: { cov: Math.round(n.coverage * 100), days: n.days } });
    else dietitian.push({ audience: 'dietitian', kind: 'energy', score: n.energyState === 'within' ? 50 : 75,
      data: { state: n.energyState, kcal: n.kcal, low: n.ref?.low ?? null, high: n.ref?.high ?? null, ref: n.ref?.kcal ?? null, source: n.ref?.source ?? null, days: n.days, cov: Math.round(n.coverage * 100) },
      maybe: n.energyState === 'below' ? [{ key: 'm_food_not_logged' }, { key: 'm_estimate_range' }] : n.energyState === 'above' ? [{ key: 'm_estimate_range' }] : [] });
    const g = n.growth;
    if (g.measurements <= 1 || g.state === 'baseline' || g.state === 'no_data') gaps.push({ audience: 'dietitian', key: 'gap_growth', p: { n: g.measurements, on: g.latest?.on ?? null } });
    if (g.latest) dietitian.push({ audience: 'dietitian', kind: 'growth', score: g.state === 'attention' ? 80 : 48, data: { ...g.latest, state: g.state, change90: g.change90, reasons: g.reasons, measurements: g.measurements }, maybe: [] });
    if (n.balanceState === 'attention' || (n.pct.carbs !== null && (n.pct.carbs < 45 || n.pct.carbs > 65)) || (n.pct.fat !== null && n.pct.fat > 35))
      dietitian.push({ audience: 'dietitian', kind: 'balance', score: 50 + 4 * n.issues.length, data: { ...n.pct, issues: n.issues, days: n.days, cov: Math.round(n.coverage * 100) }, maybe: [{ key: 'm_label_gaps' }] });
  }
  // meals behind the rises, as food: make-up and repeated dishes
  const spikes = sit.filter((s) => s.spike && s.doseAt !== null);
  const withMk = spikes.filter((s) => s.makeup && (s.makeup.fat != null || s.makeup.protein != null));
  const calm = sit.filter((s) => s.judged && !s.spike && s.doseAt !== null && s.makeup && (s.makeup.fat != null || s.makeup.protein != null));
  if (spikes.length >= R.minRepeats) {
    const names = new Map<string, number[]>();
    for (const s of spikes) if (s.makeup?.name) names.set(s.makeup.name, [...(names.get(s.makeup.name) ?? []), s.at]);
    const repeated = [...names.entries()].filter(([, ts]) => ts.length >= 2).map(([name, ts]) => ({ name, k: ts.length }));
    const fattyShare = withMk.length ? withMk.filter(isFatty).length / withMk.length : null, calmShare = calm.length ? calm.filter(isFatty).length / calm.length : null;
    if (repeated.length || (fattyShare !== null && withMk.length >= 3 && fattyShare >= 0.5))
      dietitian.push({ audience: 'dietitian', kind: 'meal_makeup', score: 60 + 5 * repeated.length,
        data: { spikes: spikes.length, repeated: repeated.slice(0, 3), withMk: withMk.length, fatty: withMk.filter(isFatty).length, calm: calm.length, calmFatty: calm.filter(isFatty).length, fattyShare, calmShare,
          latePeak: spikes.filter((s) => (s.peakMin ?? 0) >= 150).length, carbs: median(spikes.map((s) => s.carbs!).filter((x) => x != null)) },
        maybe: [{ key: 'm_dose_side' }] });
  }
  // carbs from one day to the next for the same meal: one finding for all the meals that vary
  const spread = (['breakfast', 'lunch', 'dinner'] as MealSlot[]).map((slot) => {
    const c = sit.filter((s) => s.slot === slot && s.carbs !== null).map((s) => s.carbs!);
    if (c.length < 5) return null;
    const lo = Math.min(...c), hi = Math.max(...c);
    return hi - lo >= 30 && hi >= 2 * lo ? { slot, lo, hi, md: median(c)!, n: c.length } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (spread.length) dietitian.push({ audience: 'dietitian', kind: 'carb_spread', score: 35 + 3 * spread.length, data: { list: spread }, maybe: [] });

  const pick = (xs: Finding[], k: number) => xs.sort((a, b) => b.score - a.score).slice(0, k);
  const d = pick(doctor, 5), di = pick(dietitian, 4);
  // keep the whole list to 8, giving the doctor's findings the room first
  const room = Math.max(0, 8 - d.length);
  return { doctor: d, dietitian: di.slice(0, Math.max(3, room)), gaps,
    quality: { unknownCarbs: sit.filter((s) => s.carbs === null).length, sittings: sit.length, withDose: sit.filter((s) => s.doseAt !== null).length } };
}
