// Clinical report engine, part 7: the AGP report as one model. The phone screen and the A4 PDF both draw this same
// model, so they cannot disagree. Everything is in mmol/L (the doctor reports' unit); the engine works in mg/dL.
import { DAY, grid, kwDayKey, kwDayStart, type Reading } from './cgm';
import { cgmMetrics, CV_STABLE, type CgmMetrics } from './metrics';
import { agp, type AgpPoint } from './agp';
import { glucoseEvents, libreViewLows } from './events';

export const REPORT_PERIODS = [7, 14, 30, 90] as const;
export type ReportDays = (typeof REPORT_PERIODS)[number];

export interface PatientInfo { name: string | null; birthDate: string | null; birthApprox?: boolean; diagnosisDate: string | null; clinic: string | null }

/** A report covers whole Kuwait days ending at the last midnight (today, still running, is left out), so a period
 *  has fixed dates that can be matched with LibreView's report for the same dates. */
export function reportPeriod(days: number, now: number) {
  const to = kwDayStart(now), from = to - days * DAY;
  return { from, to, days };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "29 Sep 2026" for the Kuwait day starting at `dayStart`. */
export const kwDate = (dayStart: number, year = true) => { const k = new Date(dayStart + 3 * 3600000); return `${k.getUTCDate()} ${MON[k.getUTCMonth()]}${year ? ` ${k.getUTCFullYear()}` : ''}`; };
export const kwWeekday = (dayStart: number) => DOW[new Date(dayStart + 3 * 3600000).getUTCDay()];
/** "29 Sep – 12 Oct 2026": first and last day included. */
export const periodLabel = (from: number, to: number) => `${kwDate(from, new Date(from + 3 * 3600000).getUTCFullYear() !== new Date(to - DAY + 3 * 3600000).getUTCFullYear())} – ${kwDate(to - DAY)}`;
export const mmol = (mg: number) => mg / 18.016;
export const fmt1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : (Math.round(x * 10) / 10).toFixed(1));
/** Percent for display: one decimal under 1%, else whole (as LibreView); never "0%" when there was some. */
export const fmtPct = (x: number | null | undefined) => (x == null ? '–' : x > 0 && x < 1 ? `${(Math.round(x * 10) / 10).toFixed(1)}%` : `${Math.round(x)}%`);

export interface Target { label: string; value: number; goal: string; met: boolean }
export interface DailyProfile { key: string; start: number; weekday: string; date: string; mmol: (number | null)[] /* every 15 min, 96 points */; pctActive: number }

export interface AgpReport {
  from: number; to: number; days: number; label: string; generatedAt: number;
  metrics: CgmMetrics;
  ranges: { key: 'veryHigh' | 'high' | 'inRange' | 'low' | 'veryLow'; name: string; range: string; pct: number; minutesPerDay: number }[];
  targets: Target[];
  cvStable: boolean | null;
  agp: (Omit<AgpPoint, 'p5' | 'p25' | 'p50' | 'p75' | 'p95'> & { p5: number; p25: number; p50: number; p75: number; p95: number })[]; // mmol/L; gaps left out
  daily: DailyProfile[];
  events: { lows: number; veryLows: number; extendedLows: number; highs: number; veryHighs: number; libreViewLows: number; lowsPerWeek: number };
  sufficiency: { ok: boolean; reason: string | null };
  fingerPricks: number;
}

export function buildAgpReport(o: { readings: Reading[]; from: number; to: number; now: number; fingerPricks?: number }): AgpReport {
  const { readings, from, to, now } = o;
  const m = cgmMetrics(readings, from, to, now);
  const p = m.pct ?? { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0, tight: 0 };
  const perDay = (pct: number) => Math.round((pct / 100) * 1440);
  const ranges: AgpReport['ranges'] = [
    { key: 'veryHigh', name: 'Very high', range: '>13.9 mmol/L', pct: p.veryHigh, minutesPerDay: perDay(p.veryHigh) },
    { key: 'high', name: 'High', range: '10.1–13.9 mmol/L', pct: p.high, minutesPerDay: perDay(p.high) },
    { key: 'inRange', name: 'Target range', range: '3.9–10.0 mmol/L', pct: p.inRange, minutesPerDay: perDay(p.inRange) },
    { key: 'low', name: 'Low', range: '3.0–3.8 mmol/L', pct: p.low, minutesPerDay: perDay(p.low) },
    { key: 'veryLow', name: 'Very low', range: '<3.0 mmol/L', pct: p.veryLow, minutesPerDay: perDay(p.veryLow) },
  ];
  const t = (label: string, value: number, goal: string, met: boolean): Target => ({ label, value, goal, met });
  const targets = m.pct ? [
    t('Target range 3.9–10.0', p.inRange, 'Greater than 70%', p.inRange > 70),
    t('Below 3.9', p.low + p.veryLow, 'Less than 4%', p.low + p.veryLow < 4),
    t('Below 3.0', p.veryLow, 'Less than 1%', p.veryLow < 1),
    t('Above 10.0', p.high + p.veryHigh, 'Less than 25%', p.high + p.veryHigh < 25),
    t('Above 13.9', p.veryHigh, 'Less than 5%', p.veryHigh < 5),
  ] : [];
  const ag = agp(readings, from, Math.min(to, now)).map((x) => x && { ...x, p5: mmol(x.p5), p25: mmol(x.p25), p50: mmol(x.p50), p75: mmol(x.p75), p95: mmol(x.p95) });
  const ev = glucoseEvents(readings, from, Math.min(to, now));
  const daily: DailyProfile[] = [];
  for (let d = kwDayStart(from); d < to && d < now; d += DAY) {
    const slots = grid(readings, d, Math.min(d + DAY, now));
    const pts: (number | null)[] = [];
    for (let k = 0; k < 96; k++) {
      const three = slots.slice(k * 3, k * 3 + 3).filter((s) => s.mg !== null);
      pts.push(three.length ? mmol(three.reduce((a, s) => a + s.mg!, 0) / three.length) : null);
    }
    daily.push({ key: kwDayKey(d), start: d, weekday: kwWeekday(d), date: kwDate(d, false), mmol: pts, pctActive: cgmMetrics(readings, d, Math.min(d + DAY, to), now).pctActive });
  }
  const weeks = m.days / 7;
  return {
    from, to, days: Math.round((to - from) / DAY), label: periodLabel(from, to), generatedAt: now,
    metrics: m, ranges, targets, cvStable: m.cv === null ? null : m.cv <= CV_STABLE,
    agp: ag.filter((x): x is NonNullable<typeof x> => !!x),
    daily,
    events: { lows: ev.hypo1.length, veryLows: ev.hypo2.length, extendedLows: ev.extendedHypo.length, highs: ev.high1.length, veryHighs: ev.high2.length,
      libreViewLows: libreViewLows(readings, from, Math.min(to, now)).length, lowsPerWeek: weeks ? ev.hypo1.length / weeks : 0 },
    sufficiency: { ok: m.enough.agp, reason: m.enough.reason },
    fingerPricks: o.fingerPricks ?? 0,
  };
}

/** Shown on every screen and page until the numbers have been compared with LibreView's report for the same dates. */
export const VALIDATION_NOTE = 'Not yet compared with a LibreView report for the same dates. Small differences are expected: this report uses every stored reading (mostly 1-minute), LibreView uses 15-minute data.';
