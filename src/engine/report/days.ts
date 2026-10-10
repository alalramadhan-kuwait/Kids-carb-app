// Clinical report engine, part 5: one row per Kuwait day for the Weekly Summary, Daily Log and Snapshot.
// Insulin is only what was GIVEN (events.insulin_units); the calculator's suggestions are never added in.
// Food carbs and low-treatment carbs are kept apart; a meal whose carbs are unknown is counted as unknown, never as 0;
// a meal not yet confirmed as eaten is left out. Finger-pricks are listed apart and never mixed with CGM numbers.
import { DAY, kwDayKey, kwDayStart, type Reading } from './cgm';
import { cgmMetrics, type CgmMetrics } from './metrics';
import { glucoseEvents, type GlucoseEvent } from './events';

export interface ReportInsulin { at: number; units: number; type: 'rapid' | 'long'; purpose?: string | null }
export interface ReportMeal { at: number; carbs: number | null; unknown: boolean; pending: boolean; name?: string | null; slot?: string | null }
export interface ReportTreatment { at: number; carbs: number | null; name?: string | null }
export interface FingerPrick { at: number; mg: number }

export interface DayRow {
  key: string; start: number;
  cgm: CgmMetrics;
  carbs: number;              // food carbs with a known amount (g)
  mealsUnknownCarbs: number;  // meals eaten with carbs not known (not counted in `carbs`)
  meals: number;
  treatments: number; treatmentCarbs: number;
  rapid: number; long: number; total: number | null; basalPct: number | null; rapidDoses: number;
  lows: number; veryLows: number; highs: number; veryHighs: number; // events starting this day
  fingerPricks: FingerPrick[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function dayRows(o: { readings: Reading[]; from: number; to: number; now?: number; insulin: ReportInsulin[]; meals: ReportMeal[]; treatments: ReportTreatment[]; fingerPricks?: FingerPrick[] }): DayRow[] {
  const now = o.now ?? Date.now();
  const ev = glucoseEvents(o.readings, o.from, Math.min(o.to, now));
  const starts = (xs: GlucoseEvent[], a: number, b: number) => xs.filter((e) => e.start >= a && e.start < b).length;
  const rows: DayRow[] = [];
  for (let d = kwDayStart(o.from); d < o.to && d < now; d += DAY) {
    const a = Math.max(d, o.from), b = Math.min(d + DAY, o.to);
    const inDay = <T extends { at: number }>(xs: T[]) => xs.filter((x) => x.at >= a && x.at < b);
    const ins = inDay(o.insulin), meals = inDay(o.meals).filter((m) => !m.pending), tr = inDay(o.treatments);
    const rapid = sum(ins.filter((i) => i.type === 'rapid').map((i) => i.units)), long = sum(ins.filter((i) => i.type === 'long').map((i) => i.units));
    const total = ins.length ? rapid + long : null;
    rows.push({
      key: kwDayKey(d), start: d, cgm: cgmMetrics(o.readings, a, b, now),
      carbs: sum(meals.filter((m) => !m.unknown && m.carbs !== null).map((m) => m.carbs!)), mealsUnknownCarbs: meals.filter((m) => m.unknown || m.carbs === null).length, meals: meals.length,
      treatments: tr.length, treatmentCarbs: sum(tr.map((t) => t.carbs ?? 0)),
      rapid, long, total, basalPct: total ? (long / total) * 100 : null, rapidDoses: ins.filter((i) => i.type === 'rapid').length,
      lows: starts(ev.hypo1, a, b), veryLows: starts(ev.hypo2, a, b), highs: starts(ev.high1, a, b), veryHighs: starts(ev.high2, a, b),
      fingerPricks: inDay(o.fingerPricks ?? []),
    });
  }
  return rows;
}

/** Period insulin and carb averages for the Snapshot, over the days that have any record of that kind and over all
 *  days, so a missing day is visible instead of lowering the average unnoticed. */
export function periodTotals(rows: DayRow[]) {
  const withInsulin = rows.filter((r) => r.total !== null), withFood = rows.filter((r) => r.meals > 0);
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
  return {
    days: rows.length, daysWithInsulin: withInsulin.length, daysWithFood: withFood.length,
    tdd: avg(withInsulin.map((r) => r.total!)), rapidPerDay: avg(withInsulin.map((r) => r.rapid)), longPerDay: avg(withInsulin.map((r) => r.long)),
    basalPct: (() => { const t = sum(withInsulin.map((r) => r.total!)); return t ? (sum(withInsulin.map((r) => r.long)) / t) * 100 : null; })(),
    carbsPerDay: avg(withFood.map((r) => r.carbs)), mealsUnknownCarbs: sum(rows.map((r) => r.mealsUnknownCarbs)),
    lows: sum(rows.map((r) => r.lows)), veryLows: sum(rows.map((r) => r.veryLows)), highs: sum(rows.map((r) => r.highs)), veryHighs: sum(rows.map((r) => r.veryHighs)),
    treatments: sum(rows.map((r) => r.treatments)),
  };
}
