// Clinical report engine, part 12: the Monthly Summary (LibreView's calendar): each month as a calendar, every day
// with its glucose curve (the Weekly Summary's day model, so the same curve everywhere), average, time in range and
// low events. A day before or after the report period, or without sensor data, is shown as such, never filled in.
import { KW } from './cgm';
import { buildWeeklySummary, type WeeklyDay } from './weekly';
import type { FingerPrick, ReportInsulin, ReportMeal, ReportTreatment } from './days';
import { mmol, periodLabel } from './agpReport';
import { cgmMetrics } from './metrics';

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export interface MonthCell { day: number; key: string; inPeriod: boolean; d: WeeklyDay | null }
export interface Month { label: string; weeks: (MonthCell | null)[][]; days: WeeklyDay[]; avg: number | null; tir: number | null; pctActive: number; lows: number; daysWithData: number }
export interface MonthlySummary { from: number; to: number; label: string; months: Month[] }

/** Calendar months touching the period; weeks start on Sunday (as LibreView and the Kuwaiti week). */
export function buildMonthly(o: { readings: { t: number; mg: number }[]; from: number; to: number; now: number; insulin: ReportInsulin[]; meals: ReportMeal[]; treatments: ReportTreatment[]; fingerPricks?: FingerPrick[] }): MonthlySummary {
  const all = buildWeeklySummary(o).weeks.flatMap((w) => w.days);
  const byKey = new Map(all.map((d) => [d.key, d]));
  const kw = (t: number) => new Date(t + KW);
  const first = kw(o.from), last = kw(Math.min(o.to, o.now) - 1);
  const months: Month[] = [];
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth()); m === 11 ? (y++, m = 0) : m++) {
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const cells: (MonthCell | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= n; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const day = byKey.get(key) ?? null;
      cells.push({ day: d, key, inPeriod: !!day, d: day });
    }
    while (cells.length % 7) cells.push(null);
    const weeks: (MonthCell | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const days = cells.filter((c): c is MonthCell => !!c?.d).map((c) => c.d!);
    // the month's numbers over the part of the month inside the report (shared metrics, time weighted)
    const ms = Math.max(Date.UTC(y, m, 1) - KW, o.from), me = Math.min(Date.UTC(y, m + 1, 1) - KW, o.to);
    const cm = cgmMetrics(o.readings, ms, me, o.now);
    months.push({
      label: `${MON[m]} ${y}`, weeks, days,
      avg: cm.mean === null ? null : mmol(cm.mean), tir: cm.pct ? cm.pct.inRange : null, pctActive: cm.pctActive,
      lows: days.reduce((s, d) => s + d.row.lows, 0), daysWithData: days.filter((d) => d.row.cgm.pctActive > 0).length,
    });
  }
  return { from: o.from, to: o.to, label: periodLabel(o.from, o.to), months };
}
