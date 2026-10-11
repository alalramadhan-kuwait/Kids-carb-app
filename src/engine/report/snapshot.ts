// Clinical report engine, part 10: the Snapshot (LibreView's one-page overview): glucose, low events, insulin given
// and carbohydrates for the period, side by side. Nothing new is calculated here: glucose comes from the AGP report
// model, insulin and carbs from the shared day rows (days.ts `periodTotals`), lows from the report event definition.
// Averages of insulin and carbs are over the days that have such records, and how many days that is is shown, so a
// day with nothing logged is visible instead of quietly lowering the average.
import { DAY, KW, MIN, type Reading } from './cgm';
import { dayRows, periodTotals, type FingerPrick, type ReportInsulin, type ReportMeal, type ReportTreatment } from './days';
import { glucoseEvents } from './events';
import { buildAgpReport, type AgpReport } from './agpReport';

/** Low events by the time of day they started, in six 4-hour blocks from midnight. */
export const LOW_BLOCKS = ['12am–4am', '4am–8am', '8am–12pm', '12pm–4pm', '4pm–8pm', '8pm–12am'] as const;

export interface Snapshot {
  report: AgpReport;                              // glucose: the same model as the AGP report
  lows: { count: number; perWeek: number; avgMinutes: number | null; veryLows: number; byBlock: number[]; treatments: number };
  insulin: { daysWith: number; days: number; total: number | null; rapid: number | null; long: number | null; basalPct: number | null; rapidDosesPerDay: number | null };
  carbs: { daysWith: number; days: number; perDay: number | null; mealsPerDay: number | null; unknownMeals: number };
  fingerPricks: { total: number; perDay: number };
}

export function buildSnapshot(o: { readings: Reading[]; from: number; to: number; now: number; insulin: ReportInsulin[]; meals: ReportMeal[]; treatments: ReportTreatment[]; fingerPricks?: FingerPrick[] }): Snapshot {
  const report = buildAgpReport({ readings: o.readings, from: o.from, to: o.to, now: o.now, fingerPricks: o.fingerPricks?.length ?? 0 });
  const rows = dayRows(o), tot = periodTotals(rows);
  const ev = glucoseEvents(o.readings, o.from, Math.min(o.to, o.now));
  const byBlock = [0, 0, 0, 0, 0, 0];
  for (const e of ev.hypo1) byBlock[Math.floor((((e.start + KW) % DAY) / MIN) / 240)]++;
  const withIns = rows.filter((r) => r.total !== null), withFood = rows.filter((r) => r.meals > 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const fp = rows.reduce((n, r) => n + r.fingerPricks.length, 0);
  return {
    report,
    lows: { count: ev.hypo1.length, perWeek: report.events.lowsPerWeek, avgMinutes: avg(ev.hypo1.map((e) => e.minutes)), veryLows: ev.hypo2.length, byBlock, treatments: tot.treatments },
    insulin: { daysWith: tot.daysWithInsulin, days: tot.days, total: tot.tdd, rapid: tot.rapidPerDay, long: tot.longPerDay, basalPct: tot.basalPct, rapidDosesPerDay: avg(withIns.map((r) => r.rapidDoses)) },
    carbs: { daysWith: tot.daysWithFood, days: tot.days, perDay: tot.carbsPerDay, mealsPerDay: avg(withFood.map((r) => r.meals)), unknownMeals: tot.mealsUnknownCarbs },
    fingerPricks: { total: fp, perDay: rows.length ? fp / rows.length : 0 },
  };
}
