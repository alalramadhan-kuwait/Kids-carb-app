// Basal Check: how her glucose behaves while she is fasting, at any hour, on each Tresiba dose. Pure, tested in Node.
// It replaces the overnight-only views (nightTresiba's rates, the care-team Overnight card) with one analysis.
//
// It describes. It never proposes a dose, never says a dose is right or wrong, never sets a "safe" rate of fall (none is
// validated for children), never corrects or drops a sensor reading, and never calls a low false because no finger-prick
// was taken. A treatment ends a fasting period: the readings after it are never part of any number here.
//
// Clinical references (cited in the page's info sheet and SYSTEM.md):
//   ISPAD 2022 ch. 11, Abraham et al., Pediatr Diabetes 23:1322: level 1 < 3.9 mmol/L (70), level 2 < 3.0 (54).
//   ISPAD 2022 ch. 8, de Bock et al., Pediatr Diabetes 23:1270: glucose target 3.9–10 mmol/L.
//   International consensus on CGM metrics (Battelino et al., Diabetes Care 2019 / 2023): a CGM episode lasts ≥ 15 min.
//   Tresiba (insulin degludec) prescribing information: steady state after 3–4 days; half-life about 25 h.
//   ±1.7 mmol/L (30 mg/dL) over a fasting test: an informal basal-testing reference, shown only as such.
import { doseRows, juicesOf, questioned, type DoseRow, type Prick } from './nightTresiba';
import { entriesFrom } from './predict';
import { prickPoints } from './prick';
import { agreesWith } from './fingerprick';
import { lowEpisodes, type Episode } from './day';
import { iobAt, type IobParams } from './iob';
import type { Series } from './series';
import type { EventRow, HistoryEntry } from '../lib/types';

const MIN = 60000, H = 3600000, DAY = 86400000, KW = 3 * H;

export const BC = {
  lowMg: 70, veryLowMg: 54,       // ISPAD 2022 level 1 and level 2
  stableMg: 30,                   // ±1.7 mmol/L over the period: informal reference for "stable"
  foodGapMin: 180,                // a period starts 3 h after food, carbs or a treatment
  rapidMinMin: 180,               // …and at least 3 h after NovoRapid; until 6 h it is "affected" (a tail may remain)
  rapidCleanMin: 360,
  exerciseMin: 720,               // activity in the 12 h before: its effect can be delayed (night lows after exercise)
  minLenMin: 60,                  // shorter periods are listed as excluded
  coverage: 0.7, gapMin: 20,      // less than 70 % of the period with readings, or gaps of 20 min, make it uncertain
  lowEpisodeMin: 15,              // a CGM low episode lasts 15 minutes or more (international CGM consensus)
  steadyDoses: 4,                 // Tresiba reaches steady state after 3–4 days: doses 1–3 at new units are a transition
  doseMaxH: 30,                   // without a Tresiba dose in the 30 h before, the dosing history is incomplete
  fewN: 3,                        // under 3 clean periods: insufficient evidence
  nightFromH: 0, nightToH: 6,     // the Night filter: 12 AM–6 AM (Kuwait time)
  treatPrickBeforeMin: 30, treatPrickAfterMin: 5,
} as const;

export type Status = 'clean' | 'affected' | 'uncertain' | 'excluded';
export const STATUSES: Status[] = ['clean', 'affected', 'uncertain', 'excluded'];
export type Reason = 'short' | 'no_readings' | 'rapid_recent' | 'exercise' | 'coverage' | 'artifact' | 'prick_disagrees' | 'no_dose';
export type Win = 'night' | 'day';
export type Filter = Win | 'all';
export type Phase = 'stable' | 'transition' | 'unknown';
export type Dir = 'falling' | 'stable' | 'rising';
export type Ended = 'treatment' | 'food' | 'rapid' | 'now';
/** Why a treatment was given, from what was measured then. Only a finger-prick confirms a low. */
export type TreatEvidence = 'confirmed' | 'finger_not_low' | 'cgm_low' | 'preventive';

export interface PeriodDose { units: number; t: number; nth: number; sinceH: number; daysOnDose: number; phase: Phase }
export interface Period {
  id: string; from: number; to: number; minutes: number; win: Win; nightMin: number;
  status: Status; reasons: Reason[];
  dose: PeriodDose | null;
  start: number | null; end: number | null; low: number | null; lowAt: number | null; high: number | null; // mg/dL
  change: number | null;      // end − start (smoothed ends), mg/dL
  perHour: number | null;     // change ÷ hours
  trend: number | null;       // robust slope (Theil–Sen), mg/dL per hour
  dir: Dir | null;
  belowMin: number; below54: boolean; lows: Episode[];
  coverage: number; gaps: { n: number; minutes: number };
  pricks: Prick[]; questioned: { from: number; to: number; why: string }[];
  endedBy: Ended; treatment: { t: number; evidence: TreatEvidence } | null;
  sinceRapidMin: number | null; sinceFoodMin: number | null; iobAtStart: number | null; exerciseAt: number | null;
}
export interface LowEvent { t: number; end: number; nadir: number; minutes: number; win: Win; brief: boolean; confirmed: 'finger' | 'finger_higher' | 'cgm_only' }
export interface DoseStat {
  units: number; phase: Phase; first: number;
  clean: number; other: number;           // other = affected + uncertain
  change: number | null; perHour: number | null; // medians of clean periods
  falling: number; counted: number;       // falling among clean + affected
  lows: number; treated: number; insufficient: boolean;
}
export interface BasalInputs { series: Series; history: HistoryEntry[]; events: EventRow[]; from: number; now: number; iob?: IobParams | null }
export interface BasalReport { from: number; to: number; periods: Period[]; lows: LowEvent[]; doses: DoseRow[]; pricks: Prick[] }

const median = (xs: number[]) => { if (!xs.length) return null; const d = [...xs].sort((a, b) => a - b), m = d.length >> 1; return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2; };
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Minutes of the Kuwait clock. */
export const clockMin = (t: number) => Math.floor(((t + KW) % DAY) / MIN);
const inNight = (t: number) => { const m = clockMin(t); return m >= BC.nightFromH * 60 && m < BC.nightToH * 60; };
/** Minutes of [a, b) inside the Night filter (12 AM–6 AM). */
export function nightMinutes(a: number, b: number) { let n = 0; for (let t = a; t < b; t += MIN) if (inNight(t)) n++; return n; }

/** Theil–Sen slope (median of pairwise slopes), per hour: one odd reading cannot swing it. At most 60 points. */
export function robustSlope(t: number[], v: number[]): number | null {
  if (t.length < 3) return null;
  const step = Math.max(1, Math.ceil(t.length / 60)), xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < t.length; i += step) { xs.push(t[i]); ys.push(v[i]); }
  if (xs[xs.length - 1] !== t[t.length - 1]) { xs.push(t[t.length - 1]); ys.push(v[v.length - 1]); }
  const s: number[] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] > xs[i]) s.push((ys[j] - ys[i]) / ((xs[j] - xs[i]) / H));
  return median(s);
}

export function basalCheck(inp: BasalInputs): BasalReport {
  const { series: s, history, events, now } = inp;
  const entries = entriesFrom(history, events);
  const { juices } = juicesOf(history, events, s);
  const juiceT = new Set(juices.filter((j) => j.asFood).map((j) => j.t));
  type Mark = { t: number; kind: 'food' | 'treatment' | 'rapid' };
  const marks: Mark[] = [
    ...entries.filter((e) => e.kind === 'meal' || e.kind === 'carbs').map((e) => ({ t: e.t, kind: juiceT.has(e.t) ? 'treatment' as const : 'food' as const })),
    ...entries.filter((e) => e.kind === 'treatment').map((e) => ({ t: e.t, kind: 'treatment' as const })),
    ...entries.filter((e) => e.kind === 'dose').map((e) => ({ t: e.t, kind: 'rapid' as const })),
  ].sort((a, b) => a.t - b.t);
  const exercise = entries.filter((e) => e.kind === 'exercise').map((e) => e.t);
  const rapidDoses = entries.filter((e) => e.kind === 'dose').map((e) => ({ t: e.t, units: e.units }));
  const doses = doseRows(events);
  const pricks: Prick[] = prickPoints(events.filter((e) => !e.deleted_at && e.kind === 'bg_check' && e.bg_mgdl).map((e) => ({ t: Date.parse(e.occurred_at), bg: Number(e.bg_mgdl) })).sort((a, b) => a.t - b.t), s.t, s.v)
    .map((p) => ({ ...p, agrees: p.libre === null ? null : agreesWith(p.bg, p.libre) }));
  const eats = marks.filter((m) => m.kind !== 'rapid').map((m) => m.t);
  const sm = Array.from(s.v, (x: number, i: number) => (i === 0 || i === s.v.length - 1 ? x : [s.v[i - 1], x, s.v[i + 1]].sort((p, q) => p - q)[1]));
  const lastBefore = (kind: (m: Mark) => boolean, t: number) => { let r: number | null = null; for (const m of marks) { if (m.t > t) break; if (kind(m)) r = m.t; } return r; };
  const isFood = (m: Mark) => m.kind !== 'rapid', isRapid = (m: Mark) => m.kind === 'rapid';
  const lastSeries = s.t.length ? s.t[s.t.length - 1] : now;

  // the gaps between interruptions; each gap gives at most one period
  const bounds = [...marks.map((m) => m.t)];
  const periods: Period[] = [];
  for (let k = 0; k <= bounds.length; k++) {
    const gapFrom = k === 0 ? inp.from - 2 * DAY : bounds[k - 1], gapTo = k < bounds.length ? bounds[k] : Math.min(now, lastSeries + MIN);
    if (gapTo <= inp.from || gapTo <= gapFrom) continue;
    const lf = lastBefore(isFood, gapFrom), lr = lastBefore(isRapid, gapFrom);
    const fromFood = lf === null ? -Infinity : lf + BC.foodGapMin * MIN;
    const early = Math.max(fromFood, lr === null ? -Infinity : lr + BC.rapidMinMin * MIN, gapFrom, inp.from);
    const clean = Math.max(fromFood, lr === null ? -Infinity : lr + BC.rapidCleanMin * MIN, gapFrom, inp.from);
    const a = gapTo - clean >= BC.minLenMin * MIN ? clean : early, b = gapTo;
    if (!isFinite(a) || b - a < 5 * MIN) continue; // touching entries are not a fasting period
    const next = k < bounds.length ? marks[k] : null;
    periods.push(measure(a, b, next ? next.kind : 'now', lf, lr));
  }

  function measure(a: number, b: number, endedBy: Ended, lf: number | null, lr: number | null): Period {
    // a treatment is given on the reading that prompted it: readings up to 5 minutes after are still before its effect
    const until = endedBy === 'treatment' ? b + 5 * MIN : b;
    const idx: number[] = [];
    for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] <= until && (s.t[i] < b || endedBy === 'treatment')) idx.push(i);
    const minutes = Math.round((b - a) / MIN), nightMin = nightMinutes(a, b);
    const reasons: Reason[] = [];
    // coverage: a reading stands for the time until the next, up to 15 minutes; gaps of 20 minutes or more are counted
    let seen = 0, gapN = 0, gapMin = 0, belowMs = 0;
    const edges = [a, ...idx.map((i) => s.t[i]), b];
    for (let e = 1; e < edges.length; e++) { const d = edges[e] - edges[e - 1]; if (d >= BC.gapMin * MIN) { gapN++; gapMin += d / MIN; } }
    for (const i of idx) {
      const span = Math.min(15 * MIN, (i + 1 < s.t.length ? s.t[i + 1] : s.t[i] + 5 * MIN) - s.t[i], b - s.t[i]);
      seen += span; if (s.v[i] < BC.lowMg) belowMs += span;
    }
    const coverage = Math.min(1, seen / (b - a));
    const pr = pricks.filter((p) => p.t >= a - 15 * MIN && p.t <= b + 15 * MIN);
    const q = idx.length ? questioned(s, eats, pr, a, b) : [];
    const ex = [...exercise].reverse().find((x) => x <= b && x >= a - BC.exerciseMin * MIN) ?? null;
    // the Tresiba dose in force
    let d: DoseRow | null = null;
    for (const x of doses) { if (x.t <= a) d = x; else break; }
    let dose: PeriodDose | null = null;
    if (d && a - d.t <= BC.doseMaxH * H) {
      const first = [...doses].reverse().find((x) => x.t <= d!.t && x.units === d!.units && x.nth === 1)!;
      dose = { units: d.units, t: d.t, nth: d.nth, sinceH: round1((a - d.t) / H), daysOnDose: round1((a - first.t) / DAY),
        phase: d.nth >= BC.steadyDoses ? 'stable' : d.prev === null ? 'unknown' : 'transition' };
    }
    let start: number | null = null, end: number | null = null, low: number | null = null, lowAt: number | null = null, high: number | null = null, trend: number | null = null;
    if (idx.length) {
      start = sm[idx[0]]; end = sm[idx[idx.length - 1]];
      for (const i of idx) { if (low === null || s.v[i] < low) { low = s.v[i]; lowAt = s.t[i]; } if (high === null || s.v[i] > high) high = s.v[i]; }
      const ts = idx.map((i) => s.t[i]), vs = idx.map((i) => sm[i]);
      trend = robustSlope(ts, vs);
    }
    const change = start !== null && end !== null && idx.length >= 2 ? end - start : null;
    const span = idx.length >= 2 ? (s.t[idx[idx.length - 1]] - s.t[idx[0]]) / H : 0;
    const perHour = change !== null && span > 0 ? change / span : null;
    const dir: Dir | null = change === null ? null : change <= -BC.stableMg ? 'falling' : change >= BC.stableMg ? 'rising' : 'stable';
    // a treatment that ends the period, and what was measured then
    let treatment: Period['treatment'] = null;
    if (endedBy === 'treatment') {
      const p = pricks.filter((x) => x.t >= b - BC.treatPrickBeforeMin * MIN && x.t <= b + BC.treatPrickAfterMin * MIN).sort((x, y) => Math.abs(x.t - b) - Math.abs(y.t - b))[0];
      const lastV = idx.length && b - s.t[idx[idx.length - 1]] <= 10 * MIN ? s.v[idx[idx.length - 1]] : null;
      treatment = { t: b, evidence: p ? (p.bg < BC.lowMg ? 'confirmed' : 'finger_not_low') : lastV !== null && lastV < BC.lowMg ? 'cgm_low' : 'preventive' };
    }
    // classification: the first that applies decides the status; every reason found is kept
    if (!idx.length) reasons.push('no_readings');
    if (minutes < BC.minLenMin) reasons.push('short');
    if (coverage < BC.coverage) reasons.push('coverage');
    if (q.some((x) => x.why === 'fast_fall' || x.why === 'v_shape')) reasons.push('artifact');
    if (q.some((x) => x.why === 'prick')) reasons.push('prick_disagrees');
    if (!dose) reasons.push('no_dose');
    if (lr !== null && a < lr + BC.rapidCleanMin * MIN) reasons.push('rapid_recent');
    if (ex !== null) reasons.push('exercise');
    const status: Status = reasons.includes('no_readings') || reasons.includes('short') ? 'excluded'
      : reasons.some((r) => r === 'coverage' || r === 'artifact' || r === 'prick_disagrees' || r === 'no_dose') ? 'uncertain'
        : reasons.length ? 'affected' : 'clean';
    return {
      id: String(a), from: a, to: b, minutes, win: nightMin * 2 >= minutes ? 'night' : 'day', nightMin, status, reasons, dose,
      start, end, low, lowAt, high, change, perHour, trend, dir,
      belowMin: Math.round(belowMs / MIN), below54: idx.some((i) => s.v[i] < BC.veryLowMg),
      lows: idx.length ? lowEpisodes(s, a, b, BC.lowMg, BC.lowEpisodeMin) : [],
      coverage: Math.round(coverage * 100) / 100, gaps: { n: gapN, minutes: Math.round(gapMin) },
      pricks: pr.filter((p) => p.t >= a && p.t < b), questioned: q, endedBy, treatment,
      sinceRapidMin: lr === null ? null : Math.round((a - lr) / MIN), sinceFoodMin: lf === null ? null : Math.round((a - lf) / MIN),
      iobAtStart: inp.iob ? Math.round(iobAt(a, rapidDoses, inp.iob) * 100) / 100 : null, exerciseAt: ex,
    };
  }

  // every run of CGM readings under 3.9 in the time looked at, with what the finger said; brief = under 15 minutes
  // (not an episode by the CGM consensus, often cut short by a treatment, still shown)
  const lows: LowEvent[] = lowEpisodes(s, inp.from, now, BC.lowMg, 5).map((e) => {
    const ps = pricks.filter((p) => p.t >= e.t - 15 * MIN && p.t <= e.end + 15 * MIN);
    return { ...e, win: inNight(e.t) ? 'night' as const : 'day' as const, brief: e.minutes < BC.lowEpisodeMin,
      confirmed: ps.some((p) => p.bg < BC.lowMg) ? 'finger' as const : ps.length ? 'finger_higher' as const : 'cgm_only' as const };
  });
  return { from: inp.from, to: now, periods, lows, doses, pricks: pricks.filter((p) => p.t >= inp.from && p.t <= now) };
}

export const inFilter = (w: Win, f: Filter) => f === 'all' || f === w;
const counted = (p: Period) => p.status === 'clean' || p.status === 'affected';

/** Per Tresiba dose and phase (stable / transition / unknown), in the order the doses were first given. */
export function doseStats(r: BasalReport, f: Filter): DoseStat[] {
  const out: DoseStat[] = [];
  for (const p of r.periods) {
    if (!p.dose || p.status === 'excluded' || !inFilter(p.win, f)) continue;
    let g = out.find((x) => x.units === p.dose!.units && x.phase === p.dose!.phase);
    if (!g) out.push(g = { units: p.dose.units, phase: p.dose.phase, first: p.from, clean: 0, other: 0, change: null, perHour: null, falling: 0, counted: 0, lows: 0, treated: 0, insufficient: true });
    if (p.status === 'clean') g.clean++; else g.other++;
    if (counted(p)) { g.counted++; if (p.dir === 'falling') g.falling++; }
    g.lows += p.lows.length; if (p.endedBy === 'treatment') g.treated++;
  }
  for (const g of out) {
    const c = r.periods.filter((p) => p.status === 'clean' && p.dose?.units === g.units && p.dose.phase === g.phase && inFilter(p.win, f));
    g.change = median(c.map((p) => p.change!).filter((x) => x !== null));
    g.perHour = median(c.map((p) => p.perHour!).filter((x) => x !== null));
    g.insufficient = g.clean < BC.fewN;
  }
  const firstOf = (u: number) => r.doses.find((d) => d.units === u)?.t ?? 0;
  const ph: Record<Phase, number> = { transition: 0, unknown: 0, stable: 1 };
  return out.sort((a, b) => firstOf(a.units) - firstOf(b.units) || ph[a.phase] - ph[b.phase]);
}

export interface Summary {
  eligible: number; clean: number; affected: number; uncertain: number; excluded: number;
  change: number | null; perHour: number | null; usesClean: boolean; insufficient: boolean; // typical change: clean only; else affected included, flagged
  falling: number; rising: number; stable: number;
  start: number | null; end: number | null;
  treated: number; treatedConfirmed: number;
  lows: { all: number; brief: number; finger: number; fingerHigher: number; cgmOnly: number; below54: number };
}
export function summary(r: BasalReport, f: Filter, units?: number | null): Summary {
  const ps = r.periods.filter((p) => inFilter(p.win, f) && (units == null || p.dose?.units === units));
  const by = (st: Status) => ps.filter((p) => p.status === st);
  const clean = by('clean'), elig = ps.filter(counted);
  const usesClean = clean.length >= BC.fewN, base = usesClean ? clean : elig;
  const all = r.lows.filter((l) => inFilter(l.win, f)), ls = all.filter((l) => !l.brief);
  const tr = elig.filter((p) => p.endedBy === 'treatment');
  return {
    eligible: elig.length, clean: clean.length, affected: by('affected').length, uncertain: by('uncertain').length, excluded: by('excluded').length,
    change: median(base.map((p) => p.change).filter((x): x is number => x !== null)), perHour: median(base.map((p) => p.perHour).filter((x): x is number => x !== null)),
    usesClean, insufficient: !usesClean,
    falling: elig.filter((p) => p.dir === 'falling').length, rising: elig.filter((p) => p.dir === 'rising').length, stable: elig.filter((p) => p.dir === 'stable').length,
    start: median(base.map((p) => p.start).filter((x): x is number => x !== null)), end: median(base.map((p) => p.end).filter((x): x is number => x !== null)),
    treated: tr.length, treatedConfirmed: tr.filter((p) => p.treatment?.evidence === 'confirmed').length,
    lows: { all: ls.length, brief: all.length - ls.length, finger: ls.filter((l) => l.confirmed === 'finger').length, fingerHigher: ls.filter((l) => l.confirmed === 'finger_higher').length,
      cgmOnly: ls.filter((l) => l.confirmed === 'cgm_only').length, below54: ls.filter((l) => l.nadir < BC.veryLowMg).length },
  };
}
