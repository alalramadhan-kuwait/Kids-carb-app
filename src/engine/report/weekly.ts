// Clinical report engine, part 8: the Weekly Summary (LibreView's layout): one row per day with the 24-hour glucose
// curve, carbohydrates eaten, insulin GIVEN (never the calculator's suggestion), low treatments and finger-pricks
// marked at their times, and the day's average glucose, total carbs, total insulin and low events.
// Totals come from the shared day rows (days.ts), so they match every other report. mmol/L throughout.
import { DAY, MIN, grid, kwDayStart, type Reading } from './cgm';
import { dayRows, type DayRow, type FingerPrick, type ReportInsulin, type ReportMeal, type ReportTreatment } from './days';
import { kwDate, kwWeekday, mmol, periodLabel } from './agpReport';

/** Meals within this many minutes of each other share one carb marker (their grams added), so labels do not collide. */
export const CARB_MERGE_MIN = 20;

export interface CarbMark { minute: number; grams: number | null /* null: some carbs not known */; meals: number }
export interface InsulinMark { minute: number; units: number; type: 'rapid' | 'long' }
export interface TreatMark { minute: number; grams: number | null }
export interface WeeklyDay {
  key: string; start: number; weekday: string; date: string;
  mmol: (number | null)[];           // every 5 minutes, 288 points; null = no sensor data (never filled in)
  carbs: CarbMark[]; insulin: InsulinMark[]; treatments: TreatMark[]; fingerPricks: { minute: number; mmol: number }[];
  row: DayRow;                        // the day's totals (shared engine)
  avgMmol: number | null;
}
export interface WeeklySummary { from: number; to: number; label: string; weeks: { label: string; days: WeeklyDay[] }[] }

const minuteOf = (t: number, dayStart: number) => Math.floor((t - dayStart) / MIN);

export function carbMarks(meals: ReportMeal[], dayStart: number): CarbMark[] {
  const eaten = meals.filter((m) => !m.pending && m.at >= dayStart && m.at < dayStart + DAY).sort((a, b) => a.at - b.at);
  const out: CarbMark[] = [];
  for (const m of eaten) {
    const minute = minuteOf(m.at, dayStart), known = m.unknown || m.carbs === null ? null : m.carbs;
    const last = out[out.length - 1];
    if (last && minute - last.minute <= CARB_MERGE_MIN) { last.grams = last.grams === null || known === null ? null : last.grams + known; last.meals++; }
    else out.push({ minute, grams: known, meals: 1 });
  }
  return out;
}

export function buildWeeklySummary(o: { readings: Reading[]; from: number; to: number; now: number; insulin: ReportInsulin[]; meals: ReportMeal[]; treatments: ReportTreatment[]; fingerPricks?: FingerPrick[] }): WeeklySummary {
  const rows = dayRows(o);
  const days: WeeklyDay[] = rows.map((row) => {
    const d = row.start, end = d + DAY;
    const slots = grid(o.readings, d, Math.min(end, o.now));
    const pts: (number | null)[] = Array.from({ length: 288 }, (_, k) => (slots[k]?.mg != null ? mmol(slots[k].mg!) : null));
    const inDay = <T extends { at: number }>(xs: T[]) => xs.filter((x) => x.at >= d && x.at < end);
    return {
      key: row.key, start: d, weekday: kwWeekday(d), date: kwDate(d, false), mmol: pts,
      carbs: carbMarks(o.meals, d),
      insulin: inDay(o.insulin).map((i) => ({ minute: minuteOf(i.at, d), units: i.units, type: i.type })),
      treatments: inDay(o.treatments).map((t) => ({ minute: minuteOf(t.at, d), grams: t.carbs })),
      fingerPricks: inDay(o.fingerPricks ?? []).map((f) => ({ minute: minuteOf(f.at, d), mmol: mmol(f.mg) })),
      row, avgMmol: row.cgm.mean === null ? null : mmol(row.cgm.mean),
    };
  });
  const weeks: WeeklySummary['weeks'] = [];
  for (let i = 0; i < days.length; i += 7) {
    const w = days.slice(i, i + 7);
    weeks.push({ label: periodLabel(w[0].start, w[w.length - 1].start + DAY), days: w });
  }
  return { from: o.from, to: o.to, label: periodLabel(kwDayStart(o.from), o.to), weeks };
}
